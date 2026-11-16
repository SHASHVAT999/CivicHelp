const express = require('express');
const router = express.Router();
const fs = require('fs');
const db = require('../models/db');
const auth = require('../middleware/auth');
const upload = require('../middleware/upload');
const { sendResolutionEmail } = require('../utils/email');
const { validateComplaint, parseId, clean, LIMITS, PUBLIC_FIELDS, toPublicComplaint } = require('../utils/validation');

// ---------------------------------------------------------------- helpers

// Remove an uploaded file when the request is rejected after Multer already saved it
const cleanupUploadedFile = (file) => {
  if (file && file.path) {
    fs.unlink(file.path, (unlinkErr) => {
      if (unlinkErr && unlinkErr.code !== 'ENOENT') {
        console.error('[Upload Cleanup Error] Failed to remove orphaned file:', unlinkErr.message);
      }
    });
  }
};

// One complaint with the names staff and citizens see. citizen_email is only used server-side.
const DETAIL_SELECT = `
  SELECT c.*,
    u.name AS citizen_name, u.email AS citizen_email,
    w.name AS worker_name
  FROM complaints c
  LEFT JOIN users u ON c.citizen_id = u.id
  LEFT JOIN users w ON c.assigned_to = w.id`;

const getComplaintDetail = async (id) => {
  const [rows] = await db.query(`${DETAIL_SELECT} WHERE c.id = ?`, [id]);
  return rows[0] || null;
};

// Never send a citizen's email address back over the API
const withoutEmail = ({ citizen_email: _removed, ...rest }) => rest;

// Everyone (including the public map) is told about status changes, but only with public fields
const broadcast = (req, event, complaint) => req.app.get('io').emit(event, toPublicComplaint(complaint));

const isStaff = (role) => role === 'officer' || role === 'worker';

// Rejects non-numeric ids before they reach SQL; stores the parsed id on req.complaintId
const requireComplaintId = (req, res, next) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(404).json({ error: 'Complaint not found' });
  req.complaintId = id;
  next();
};

// ---------------------------------------------------------------- read endpoints

// Public map: minimal fields only
router.get('/', async (req, res) => {
  try {
    const [complaints] = await db.query(
      `SELECT ${PUBLIC_FIELDS.join(', ')} FROM complaints ORDER BY created_at DESC`
    );
    res.json(complaints);
  } catch (err) {
    console.error('[Complaints Error] Public map fetch failed:', err);
    res.status(500).json({ error: 'Failed to retrieve complaints data' });
  }
});

// Ward officer: every complaint with citizen and worker names
router.get('/officer', auth, async (req, res) => {
  if (req.user.role !== 'officer') {
    return res.status(403).json({ error: 'Unauthorized: only ward officers can access management data' });
  }
  try {
    const [complaints] = await db.query(`${DETAIL_SELECT} ORDER BY c.created_at DESC`);
    res.json(complaints.map(withoutEmail));
  } catch (err) {
    console.error('[Complaints Error] Officer data fetch failed:', err);
    res.status(500).json({ error: 'Failed to retrieve management data' });
  }
});

// Citizen: own complaints
router.get('/my', auth, async (req, res) => {
  try {
    const [complaints] = await db.query(
      `SELECT c.*, w.name AS worker_name
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

// Field worker: complaints assigned to them
router.get('/assigned', auth, async (req, res) => {
  try {
    const [complaints] = await db.query(
      `SELECT c.*, u.name AS citizen_name
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

// Ward officer: roster of field workers
router.get('/workers', auth, async (req, res) => {
  if (req.user.role !== 'officer') {
    return res.status(403).json({ error: 'Unauthorized: only ward officers can view worker roster' });
  }
  try {
    const [workers] = await db.query("SELECT id, name, email FROM users WHERE role = 'worker' ORDER BY name");
    res.json(workers);
  } catch (err) {
    console.error('[Complaints Error] Worker list fetch failed:', err);
    res.status(500).json({ error: 'Failed to retrieve worker roster' });
  }
});

// ---------------------------------------------------------------- citizen reports an issue

router.post('/', auth, upload.single('image'), async (req, res) => {
  const { error, value } = validateComplaint(req.body || {});
  if (error) {
    cleanupUploadedFile(req.file);
    return res.status(400).json({ error });
  }

  const image_url = req.file ? `/uploads/${req.file.filename}` : null;
  try {
    const [result] = await db.query(
      `INSERT INTO complaints
       (citizen_id, category, description, latitude, longitude, address, image_url, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'open')`,
      [req.user.id, value.category, value.description, value.latitude, value.longitude, value.address, image_url]
    );
    const created = await getComplaintDetail(result.insertId);
    broadcast(req, 'newComplaint', created);
    res.status(201).json(withoutEmail(created));
  } catch (err) {
    cleanupUploadedFile(req.file);
    console.error('[Complaints Error] Create complaint failure:', err);
    res.status(500).json({ error: 'Failed to submit complaint' });
  }
});

// ---------------------------------------------------------------- officer assigns a worker

router.patch('/:id/assign', auth, requireComplaintId, async (req, res) => {
  if (req.user.role !== 'officer') {
    return res.status(403).json({ error: 'Only officers can assign complaints' });
  }
  const workerId = parseId((req.body || {}).worker_id);
  if (!workerId) {
    return res.status(400).json({ error: 'Worker ID is required' });
  }

  try {
    const [workerRows] = await db.query("SELECT id FROM users WHERE id = ? AND role = 'worker'", [workerId]);
    if (workerRows.length === 0) {
      return res.status(400).json({ error: 'Selected user is not a registered field worker' });
    }

    const [existing] = await db.query('SELECT status FROM complaints WHERE id = ?', [req.complaintId]);
    if (existing.length === 0) {
      return res.status(404).json({ error: 'Complaint not found' });
    }
    if (existing[0].status === 'resolved') {
      return res.status(400).json({ error: 'Resolved complaints cannot be reassigned' });
    }

    await db.query("UPDATE complaints SET assigned_to = ?, status = 'in_progress' WHERE id = ?", [workerId, req.complaintId]);
    const updated = await getComplaintDetail(req.complaintId);
    broadcast(req, 'statusUpdated', updated);
    res.json(withoutEmail(updated));
  } catch (err) {
    console.error('[Complaints Error] Assign worker failure:', err);
    res.status(500).json({ error: 'Failed to assign complaint' });
  }
});

// ---------------------------------------------------------------- staff change status (not "resolved")

router.patch('/:id/status', auth, requireComplaintId, async (req, res) => {
  const { status } = req.body || {};
  const { role, id: userId } = req.user || {};

  if (!['open', 'in_progress', 'resolved'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status. Must be open, in_progress, or resolved.' });
  }
  // Resolving needs a photo as proof, so it has its own endpoint
  if (status === 'resolved') {
    return res.status(400).json({
      error: 'Marking a complaint as resolved requires submitting resolution proof via POST /api/complaints/:id/resolve'
    });
  }
  if (!isStaff(role)) {
    return res.status(403).json({ error: 'Unauthorized: only ward officers and assigned field workers can update status' });
  }

  try {
    const [rows] = await db.query('SELECT assigned_to FROM complaints WHERE id = ?', [req.complaintId]);
    if (role === 'worker' && (rows.length === 0 || rows[0].assigned_to !== userId)) {
      return res.status(403).json({ error: 'Not your assigned complaint' });
    }
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Complaint not found' });
    }

    await db.query('UPDATE complaints SET status = ? WHERE id = ?', [status, req.complaintId]);
    const updated = await getComplaintDetail(req.complaintId);
    broadcast(req, 'statusUpdated', updated);
    res.json(withoutEmail(updated));
  } catch (err) {
    console.error('[Complaints Error] Status update failure:', err);
    res.status(500).json({ error: 'Failed to update complaint status' });
  }
});

// ---------------------------------------------------------------- staff resolve with a photo as proof

const handleResolveComplaint = async (req, res) => {
  const { role, id: userId } = req.user || {};
  const reject = (code, error) => { cleanupUploadedFile(req.file); return res.status(code).json({ error }); };

  if (!isStaff(role)) {
    return reject(403, 'Unauthorized: only ward officers and assigned field workers can resolve complaints');
  }

  try {
    const [rows] = await db.query('SELECT id, assigned_to FROM complaints WHERE id = ?', [req.complaintId]);
    if (rows.length === 0) return reject(404, 'Complaint not found');
    if (role === 'worker' && rows[0].assigned_to !== userId) return reject(403, 'Not your assigned complaint');
    if (!req.file) return reject(400, 'Resolution photograph is required to resolve a complaint.');

    const notes = clean((req.body || {}).resolution_notes) || null;
    if (notes && notes.length > LIMITS.notes) return reject(400, `Resolution notes must be at most ${LIMITS.notes} characters.`);

    // A new resolution (also after a citizen reopened it) asks the citizen to confirm again
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
      [new Date(), `/uploads/${req.file.filename}`, notes, req.complaintId]
    );

    const updated = await getComplaintDetail(req.complaintId);
    if (updated.citizen_email) {
      // Fire-and-forget: a mail problem must never fail the resolution
      sendResolutionEmail(updated.citizen_email, updated.citizen_name, updated.category, updated.address);
    }
    broadcast(req, 'statusUpdated', updated);
    res.json(withoutEmail(updated));
  } catch (err) {
    cleanupUploadedFile(req.file);
    console.error('[Complaints Error] Resolve failure:', err);
    res.status(500).json({ error: 'Failed to resolve complaint' });
  }
};

router.post('/:id/resolve', auth, requireComplaintId, upload.single('resolution_image'), handleResolveComplaint);
router.patch('/:id/resolve', auth, requireComplaintId, upload.single('resolution_image'), handleResolveComplaint);

// ---------------------------------------------------------------- citizen confirms the fix or reopens

const handleCitizenVerification = async (req, res) => {
  const { action, feedback } = req.body || {};
  const normalizedAction = (action === 'confirm' || action === 'confirmed')
    ? 'confirmed'
    : (action === 'reopen' || action === 'reopened') ? 'reopened' : null;

  if (!normalizedAction) {
    return res.status(400).json({ error: "Invalid action. Must be 'confirm' or 'reopen'." });
  }
  const cleanFeedback = clean(feedback) || null;
  if (normalizedAction === 'reopened' && !cleanFeedback) {
    return res.status(400).json({ error: 'Please provide an explanation for requesting reopening.' });
  }
  if (cleanFeedback && cleanFeedback.length > LIMITS.feedback) {
    return res.status(400).json({ error: `Feedback must be at most ${LIMITS.feedback} characters.` });
  }

  try {
    const [rows] = await db.query(
      'SELECT citizen_id, status, resolution_image_url, citizen_confirmation_status FROM complaints WHERE id = ?',
      [req.complaintId]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Complaint not found' });
    const complaint = rows[0];

    if (complaint.citizen_id !== req.user.id) {
      return res.status(403).json({ error: 'Forbidden: you can only confirm or reopen complaints that you reported.' });
    }
    if (complaint.status !== 'resolved') {
      return res.status(400).json({ error: 'Only resolved complaints can be confirmed or reopened.' });
    }
    // Complaints resolved before photo proof existed do not need verification
    if (!complaint.resolution_image_url) {
      return res.status(400).json({ error: 'Cannot verify a complaint that has no resolution proof.' });
    }
    if (complaint.citizen_confirmation_status !== 'pending') {
      return res.status(400).json({
        error: `Verification is not pending for this complaint (current status: ${complaint.citizen_confirmation_status}).`
      });
    }

    const newStatus = normalizedAction === 'reopened' ? 'in_progress' : 'resolved';
    await db.query(
      `UPDATE complaints
       SET status = ?, citizen_confirmation_status = ?, citizen_feedback = ?, citizen_feedback_at = ?
       WHERE id = ?`,
      [newStatus, normalizedAction, cleanFeedback, new Date(), req.complaintId]
    );

    const updated = await getComplaintDetail(req.complaintId);
    if (newStatus === 'in_progress') broadcast(req, 'statusUpdated', updated);
    res.json(withoutEmail(updated));
  } catch (err) {
    console.error('[Complaints Error] Citizen verification failure:', err);
    res.status(500).json({ error: 'Failed to submit verification' });
  }
};

router.post('/:id/verify', auth, requireComplaintId, handleCitizenVerification);
router.patch('/:id/verify', auth, requireComplaintId, handleCitizenVerification);

module.exports = router;
