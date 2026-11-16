const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const db = require('../models/db');
const auth = require('../middleware/auth');
const upload = require('../middleware/upload');
const nodemailer = require('nodemailer');

// Clean up an uploaded file if validation or database insertion fails
const cleanupUploadedFile = (file) => {
  if (file && file.path) {
    fs.unlink(file.path, (unlinkErr) => {
      if (unlinkErr && unlinkErr.code !== 'ENOENT') {
        console.error('[Upload Cleanup Error] Failed to remove orphaned file:', unlinkErr.message);
      }
    });
  }
};

// Optional Email transporter (SMTP credentials optional)
let transporter = null;
if (process.env.EMAIL_USER && process.env.EMAIL_PASS) {
  transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    }
  });
} else {
  console.log('[Notification] EMAIL_USER / EMAIL_PASS not configured. Resolution emails will be skipped.');
}

// Escape user-supplied text before embedding it in email HTML
const escapeHtml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const sendResolutionEmail = async (citizenEmail, rawName, rawCategory, rawAddress) => {
  if (!transporter || !process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    console.log('[Notification] Skipping resolution email: SMTP not configured.');
    return;
  }
  const citizenName = escapeHtml(rawName);
  const category = escapeHtml(rawCategory);
  const address = rawAddress ? escapeHtml(rawAddress) : '';
  try {
    await transporter.sendMail({
      from: `"CivicHelp" <${process.env.EMAIL_USER}>`,
      to: citizenEmail,
      subject: 'Your complaint has been resolved!',
      html: `
        <div style="font-family:Inter,sans-serif;max-width:500px;margin:0 auto;padding:32px;background:#f9f9f9;border-radius:16px;">
          <div style="background:#1a1a1a;border-radius:12px;padding:20px;text-align:center;margin-bottom:24px;">
            <h1 style="color:white;margin:0;font-size:24px;">CivicHelp</h1>
          </div>
          <h2 style="color:#1a1a1a;">Your complaint is resolved! ✅</h2>
          <p style="color:#555;line-height:1.7;">Hi ${citizenName},</p>
          <p style="color:#555;line-height:1.7;">
            Great news! Your complaint about <strong>${category}</strong> at
            <strong>${address || 'the reported location'}</strong> has been resolved by our field team.
          </p>
          <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:16px;margin:20px 0;">
            <p style="color:#16a34a;font-weight:600;margin:0;">✅ Status: Resolved</p>
          </div>
          <p style="color:#555;line-height:1.7;">Thank you for helping improve your city!</p>
          <p style="color:#555;">— Team CivicHelp</p>
        </div>
      `
    });
    console.log('[Notification] Resolution email sent to:', citizenEmail);
  } catch (err) {
    console.error('[Notification] Email error:', err.message);
  }
};

// Get all complaints (public - minimal fields for map)
router.get('/', async (req, res) => {
  try {
    const [complaints] = await db.query(`
      SELECT id, category, description,
        latitude, longitude, address, image_url,
        status, resolved_at, created_at
      FROM complaints
      ORDER BY created_at DESC
    `);
    res.json(complaints);
  } catch (err) {
    console.error('[Complaints Error] Public map fetch failed:', err);
    res.status(500).json({ error: 'Failed to retrieve complaints data' });
  }
});

// Get all complaints for management (ward officer only)
router.get('/officer', auth, async (req, res) => {
  if (req.user.role !== 'officer') {
    return res.status(403).json({ error: 'Unauthorized: only ward officers can access management data' });
  }
  try {
    const [complaints] = await db.query(`
      SELECT c.*,
        u.name as citizen_name,
        w.name as worker_name
      FROM complaints c
      LEFT JOIN users u ON c.citizen_id = u.id
      LEFT JOIN users w ON c.assigned_to = w.id
      ORDER BY c.created_at DESC
    `);
    res.json(complaints);
  } catch (err) {
    console.error('[Complaints Error] Officer data fetch failed:', err);
    res.status(500).json({ error: 'Failed to retrieve management data' });
  }
});

// Get my complaints (citizen)
router.get('/my', auth, async (req, res) => {
  try {
    const [complaints] = await db.query(
      `SELECT c.*, w.name as worker_name
       FROM complaints c
       LEFT JOIN users w ON c.assigned_to = w.id
       WHERE c.citizen_id = ? ORDER BY c.created_at DESC`,
      [req.user.id]
    );
    res.json(complaints);
  } catch (err) {
    console.error('[Complaints Error] Citizen complaints fetch failed:', err);
    res.status(500).json({ error: 'Failed to retrieve your complaints' });
  }
});

// Get assigned complaints (field worker only)
router.get('/assigned', auth, async (req, res) => {
  try {
    const [complaints] = await db.query(
      `SELECT c.*, u.name as citizen_name
       FROM complaints c
       LEFT JOIN users u ON c.citizen_id = u.id
       WHERE c.assigned_to = ? ORDER BY c.created_at DESC`,
      [req.user.id]
    );
    res.json(complaints);
  } catch (err) {
    console.error('[Complaints Error] Worker assignments fetch failed:', err);
    res.status(500).json({ error: 'Failed to retrieve assigned complaints' });
  }
});

// Get all field workers (officer only)
router.get('/workers', auth, async (req, res) => {
  if (req.user.role !== 'officer') {
    return res.status(403).json({ error: 'Unauthorized: only ward officers can view worker roster' });
  }
  try {
    const [workers] = await db.query(
      "SELECT id, name, email FROM users WHERE role = 'worker'"
    );
    res.json(workers);
  } catch (err) {
    console.error('[Complaints Error] Worker list fetch failed:', err);
    res.status(500).json({ error: 'Failed to retrieve worker roster' });
  }
});

// Submit new complaint (with image upload)
router.post('/', auth, upload.single('image'), async (req, res) => {
  const { category, description, latitude, longitude, address } = req.body;

  if (!category || !latitude || !longitude) {
    cleanupUploadedFile(req.file);
    return res.status(400).json({ error: 'Category, latitude, and longitude are required.' });
  }

  const parsedLat = parseFloat(latitude);
  const parsedLng = parseFloat(longitude);
  if (isNaN(parsedLat) || isNaN(parsedLng)) {
    cleanupUploadedFile(req.file);
    return res.status(400).json({ error: 'Invalid coordinates provided.' });
  }

  const image_url = req.file ? `/uploads/${req.file.filename}` : null;
  try {
    const [result] = await db.query(
      `INSERT INTO complaints
       (citizen_id, category, description, latitude, longitude, address, image_url, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'open')`,
      [req.user.id, category, description || '', parsedLat, parsedLng, address || '', image_url]
    );

    const [newComplaint] = await db.query(
      `SELECT c.*, u.name as citizen_name FROM complaints c
       LEFT JOIN users u ON c.citizen_id = u.id WHERE c.id = ?`,
      [result.insertId]
    );

    // Public broadcast: only map fields (no citizen personal data)
    const publicComplaint = {
      id: newComplaint[0].id,
      category: newComplaint[0].category,
      description: newComplaint[0].description,
      latitude: newComplaint[0].latitude,
      longitude: newComplaint[0].longitude,
      address: newComplaint[0].address,
      image_url: newComplaint[0].image_url,
      status: newComplaint[0].status,
      resolved_at: newComplaint[0].resolved_at,
      created_at: newComplaint[0].created_at,
    };
    req.app.get('io').emit('newComplaint', publicComplaint);
    res.status(201).json(newComplaint[0]);
  } catch (err) {
    cleanupUploadedFile(req.file);
    console.error('[Complaints Error] Create complaint failure:', err);
    res.status(500).json({ error: 'Failed to submit complaint' });
  }
});

// Assign complaint to worker (officer only)
router.patch('/:id/assign', auth, async (req, res) => {
  if (req.user.role !== 'officer') {
    return res.status(403).json({ error: 'Only officers can assign complaints' });
  }
  const { worker_id } = req.body;
  if (!worker_id) {
    return res.status(400).json({ error: 'Worker ID is required' });
  }

  try {
    // The assignee must be an existing field worker
    const [workerRows] = await db.query(
      "SELECT id FROM users WHERE id = ? AND role = 'worker'",
      [worker_id]
    );
    if (workerRows.length === 0) {
      return res.status(400).json({ error: 'Selected user is not a registered field worker' });
    }

    const [existing] = await db.query('SELECT status FROM complaints WHERE id = ?', [req.params.id]);
    if (existing.length === 0) {
      return res.status(404).json({ error: 'Complaint not found' });
    }
    if (existing[0].status === 'resolved') {
      return res.status(400).json({ error: 'Resolved complaints cannot be reassigned' });
    }

    await db.query(
      "UPDATE complaints SET assigned_to = ?, status = 'in_progress' WHERE id = ?",
      [worker_id, req.params.id]
    );
    const [updated] = await db.query(
      `SELECT c.*, u.name as citizen_name, w.name as worker_name
       FROM complaints c
       LEFT JOIN users u ON c.citizen_id = u.id
       LEFT JOIN users w ON c.assigned_to = w.id
       WHERE c.id = ?`,
      [req.params.id]
    );
    if (updated.length === 0) {
      return res.status(404).json({ error: 'Complaint not found' });
    }
    // Public broadcast: only map fields (no staff or citizen names)
    const publicUpdate = {
      id: updated[0].id,
      category: updated[0].category,
      description: updated[0].description,
      latitude: updated[0].latitude,
      longitude: updated[0].longitude,
      address: updated[0].address,
      image_url: updated[0].image_url,
      status: updated[0].status,
      resolved_at: updated[0].resolved_at,
      created_at: updated[0].created_at,
    };
    req.app.get('io').emit('statusUpdated', publicUpdate);
    res.json(updated[0]);
  } catch (err) {
    console.error('[Complaints Error] Assign worker failure:', err);
    res.status(500).json({ error: 'Failed to assign complaint' });
  }
});

// Update complaint status (start task, etc. - resolving requires resolution proof)
router.patch('/:id/status', auth, async (req, res) => {
  const { status } = req.body;
  const { role, id: userId } = req.user || {};

  const validStatuses = ['open', 'in_progress', 'resolved'];
  if (!validStatuses.includes(status)) {
    return res.status(400).json({ error: 'Invalid status. Must be open, in_progress, or resolved.' });
  }

  // Disallow resolving without proof
  if (status === 'resolved') {
    return res.status(400).json({
      error: 'Marking a complaint as resolved requires submitting resolution proof via POST /api/complaints/:id/resolve'
    });
  }

  // Strict allowlist: only officer and worker roles may proceed
  if (role !== 'officer' && role !== 'worker') {
    return res.status(403).json({ error: 'Unauthorized: only ward officers and assigned field workers can update status' });
  }

  // Field workers can only update complaints assigned to them
  if (role === 'worker') {
    const [check] = await db.query(
      'SELECT id FROM complaints WHERE id = ? AND assigned_to = ?',
      [req.params.id, userId]
    );
    if (check.length === 0) {
      return res.status(403).json({ error: 'Not your assigned complaint' });
    }
  }

  try {
    await db.query(
      'UPDATE complaints SET status = ? WHERE id = ?',
      [status, req.params.id]
    );

    const [updated] = await db.query(
      `SELECT c.*,
        u.name as citizen_name, u.email as citizen_email,
        w.name as worker_name
       FROM complaints c
       LEFT JOIN users u ON c.citizen_id = u.id
       LEFT JOIN users w ON c.assigned_to = w.id
       WHERE c.id = ?`,
      [req.params.id]
    );

    if (updated.length === 0) {
      return res.status(404).json({ error: 'Complaint not found' });
    }

    // Public broadcast: only map fields (no personal or staff data)
    const publicUpdate = {
      id: updated[0].id,
      category: updated[0].category,
      description: updated[0].description,
      latitude: updated[0].latitude,
      longitude: updated[0].longitude,
      address: updated[0].address,
      image_url: updated[0].image_url,
      status: updated[0].status,
      resolved_at: updated[0].resolved_at,
      created_at: updated[0].created_at,
    };
    req.app.get('io').emit('statusUpdated', publicUpdate);

    // HTTP response to authorized officer/worker (stripped of citizen email)
    const { citizen_email: _removed, ...responseData } = updated[0];
    res.json(responseData);
  } catch (err) {
    console.error('[Complaints Error] Status update failure:', err);
    res.status(500).json({ error: 'Failed to update complaint status' });
  }
});

// Resolve complaint with resolution proof (officer or assigned worker only)
const handleResolveComplaint = async (req, res) => {
  const { role, id: userId } = req.user || {};

  // Strict allowlist: only officer and worker roles may resolve
  if (role !== 'officer' && role !== 'worker') {
    cleanupUploadedFile(req.file);
    return res.status(403).json({ error: 'Unauthorized: only ward officers and assigned field workers can resolve complaints' });
  }

  // Field workers can only resolve complaints assigned to them
  if (role === 'worker') {
    const [check] = await db.query(
      'SELECT id FROM complaints WHERE id = ? AND assigned_to = ?',
      [req.params.id, userId]
    );
    if (check.length === 0) {
      cleanupUploadedFile(req.file);
      return res.status(403).json({ error: 'Not your assigned complaint' });
    }
  }

  // Check if complaint exists
  const [complaint] = await db.query(
    'SELECT * FROM complaints WHERE id = ?',
    [req.params.id]
  );
  if (complaint.length === 0) {
    cleanupUploadedFile(req.file);
    return res.status(404).json({ error: 'Complaint not found' });
  }

  // Mandatory: Resolution photograph is required
  if (!req.file) {
    return res.status(400).json({ error: 'Resolution photograph is required to resolve a complaint.' });
  }

  const resolution_image_url = `/uploads/${req.file.filename}`;
  const resolution_notes = req.body.resolution_notes ? req.body.resolution_notes.trim() : null;
  const resolvedAt = new Date();

  try {
    // When staff resolves (or re-resolves a reopened complaint), reset confirmation to 'pending'
    // and clear any previous citizen feedback for this new resolution cycle
    await db.query(
      `UPDATE complaints
       SET status = 'resolved',
           resolved_at = ?,
           resolution_image_url = ?,
           resolution_notes = ?,
           citizen_confirmation_status = 'pending',
           citizen_feedback = NULL,
           citizen_feedback_at = NULL
       WHERE id = ?`,
      [resolvedAt, resolution_image_url, resolution_notes, req.params.id]
    );

    const [updated] = await db.query(
      `SELECT c.*,
        u.name as citizen_name, u.email as citizen_email,
        w.name as worker_name
       FROM complaints c
       LEFT JOIN users u ON c.citizen_id = u.id
       LEFT JOIN users w ON c.assigned_to = w.id
       WHERE c.id = ?`,
      [req.params.id]
    );

    // Send email notification to citizen when resolved (safe & optional)
    if (updated[0].citizen_email) {
      sendResolutionEmail(
        updated[0].citizen_email,
        updated[0].citizen_name,
        updated[0].category,
        updated[0].address
      );
    }

    // Public broadcast: only map fields (no personal or staff data)
    const publicUpdate = {
      id: updated[0].id,
      category: updated[0].category,
      description: updated[0].description,
      latitude: updated[0].latitude,
      longitude: updated[0].longitude,
      address: updated[0].address,
      image_url: updated[0].image_url,
      status: updated[0].status,
      resolved_at: updated[0].resolved_at,
      created_at: updated[0].created_at,
    };
    req.app.get('io').emit('statusUpdated', publicUpdate);

    // HTTP response to authorized officer/worker (stripped of citizen email)
    const { citizen_email: _removed, ...responseData } = updated[0];
    res.json(responseData);
  } catch (err) {
    cleanupUploadedFile(req.file);
    console.error('[Complaints Error] Resolve failure:', err);
    res.status(500).json({ error: 'Failed to resolve complaint' });
  }
};

router.post('/:id/resolve', auth, upload.single('resolution_image'), handleResolveComplaint);
router.patch('/:id/resolve', auth, upload.single('resolution_image'), handleResolveComplaint);

// Citizen verification (confirm fixed or request reopening)
const handleCitizenVerification = async (req, res) => {
  const { action, feedback } = req.body;
  const userId = req.user.id;

  const normalizedAction = (action === 'confirm' || action === 'confirmed')
    ? 'confirmed'
    : (action === 'reopen' || action === 'reopened')
      ? 'reopened'
      : null;

  if (!normalizedAction) {
    return res.status(400).json({
      error: "Invalid action. Must be 'confirm' or 'reopen'."
    });
  }

  if (normalizedAction === 'reopened' && (!feedback || !feedback.trim())) {
    return res.status(400).json({
      error: 'Please provide an explanation for requesting reopening.'
    });
  }

  try {
    const [complaints] = await db.query(
      'SELECT * FROM complaints WHERE id = ?',
      [req.params.id]
    );

    if (complaints.length === 0) {
      return res.status(404).json({ error: 'Complaint not found' });
    }

    const complaint = complaints[0];

    // Only the citizen who reported the complaint may verify it
    if (complaint.citizen_id !== userId) {
      return res.status(403).json({
        error: 'Forbidden: you can only confirm or reopen complaints that you reported.'
      });
    }

    // Must be in resolved status to verify
    if (complaint.status !== 'resolved') {
      return res.status(400).json({
        error: 'Only resolved complaints can be confirmed or reopened.'
      });
    }

    // Must have resolution proof (legacy resolved complaints do not require citizen verification)
    if (!complaint.resolution_image_url) {
      return res.status(400).json({
        error: 'Cannot verify a complaint that has no resolution proof.'
      });
    }

    // Disallow repeated submissions for the same resolution cycle
    if (complaint.citizen_confirmation_status !== 'pending') {
      return res.status(400).json({
        error: `Verification is not pending for this complaint (current status: ${complaint.citizen_confirmation_status}).`
      });
    }

    const newStatus = normalizedAction === 'reopened' ? 'in_progress' : 'resolved';
    const cleanFeedback = feedback ? feedback.trim() : null;
    const feedbackAt = new Date();

    await db.query(
      `UPDATE complaints
       SET status = ?,
           citizen_confirmation_status = ?,
           citizen_feedback = ?,
           citizen_feedback_at = ?
       WHERE id = ?`,
      [newStatus, normalizedAction, cleanFeedback, feedbackAt, req.params.id]
    );

    const [updated] = await db.query(
      `SELECT c.*,
        w.name as worker_name
       FROM complaints c
       LEFT JOIN users w ON c.assigned_to = w.id
       WHERE c.id = ?`,
      [req.params.id]
    );

    // Broadcast status change to Socket.IO if reopened (status changed back to in_progress)
    if (newStatus === 'in_progress') {
      const publicUpdate = {
        id: updated[0].id,
        category: updated[0].category,
        description: updated[0].description,
        latitude: updated[0].latitude,
        longitude: updated[0].longitude,
        address: updated[0].address,
        image_url: updated[0].image_url,
        status: updated[0].status,
        resolved_at: updated[0].resolved_at,
        created_at: updated[0].created_at,
      };
      req.app.get('io').emit('statusUpdated', publicUpdate);
    }

    res.json(updated[0]);
  } catch (err) {
    console.error('[Complaints Error] Citizen verification failure:', err);
    res.status(500).json({ error: 'Failed to submit verification' });
  }
};

router.post('/:id/verify', auth, handleCitizenVerification);
router.patch('/:id/verify', auth, handleCitizenVerification);

module.exports = router;
