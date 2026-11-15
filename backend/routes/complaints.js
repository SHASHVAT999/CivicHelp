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

const sendResolutionEmail = async (citizenEmail, citizenName, category, address) => {
  if (!transporter || !process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    console.log(`[Notification] Skipping resolution email for complaint at "${address}". SMTP not configured.`);
    return;
  }
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
      SELECT c.id, c.citizen_id, c.category, c.description,
        c.latitude, c.longitude, c.address, c.image_url,
        c.status, c.assigned_to, c.resolved_at, c.created_at,
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

// Update complaint status
router.patch('/:id/status', auth, async (req, res) => {
  const { status } = req.body;
  const { role, id: userId } = req.user || {};

  const validStatuses = ['open', 'in_progress', 'resolved'];
  if (!validStatuses.includes(status)) {
    return res.status(400).json({ error: 'Invalid status. Must be open, in_progress, or resolved.' });
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
    const resolvedAt = status === 'resolved' ? new Date() : null;
    await db.query(
      'UPDATE complaints SET status = ?, resolved_at = ? WHERE id = ?',
      [status, resolvedAt, req.params.id]
    );

    const [updated] = await db.query(
      `SELECT c.id, c.citizen_id, c.category, c.description,
        c.latitude, c.longitude, c.address, c.image_url,
        c.status, c.assigned_to, c.resolved_at, c.created_at,
        u.name as citizen_name, u.email as citizen_email,
        w.name as worker_name
       FROM complaints c
       LEFT JOIN users u ON c.citizen_id = u.id
       LEFT JOIN users w ON c.assigned_to = w.id
       WHERE c.id = ?`,
      [req.params.id]
    );

    // Check if complaint exists before accessing properties
    if (updated.length === 0) {
      return res.status(404).json({ error: 'Complaint not found' });
    }

    // Send email notification to citizen when resolved (safe & optional)
    if (status === 'resolved' && updated[0].citizen_email) {
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
    console.error('[Complaints Error] Status update failure:', err);
    res.status(500).json({ error: 'Failed to update complaint status' });
  }
});

module.exports = router;
