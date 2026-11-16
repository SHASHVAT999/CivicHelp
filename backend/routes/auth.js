const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../models/db');
const { validateRegistration, clean } = require('../utils/validation');

// Register — role is always 'citizen' regardless of request payload
router.post('/register', async (req, res) => {
  const { name, email, password } = req.body || {};
  const problem = validateRegistration({ name, email, password });
  if (problem) {
    return res.status(400).json({ error: problem });
  }

  try {
    const hashedPassword = await bcrypt.hash(String(password), 10);
    await db.query(
      'INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)',
      [clean(name), clean(email), hashedPassword, 'citizen']
    );
    res.status(201).json({ message: 'User registered successfully' });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'An account with this email address already exists.' });
    }
    console.error('[Auth Error] Registration failure:', err);
    res.status(500).json({ error: 'Registration failed due to a server error. Please try again.' });
  }
});

// Login
router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!clean(email) || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  try {
    const [users] = await db.query('SELECT id, name, role, password FROM users WHERE email = ?', [clean(email)]);
    if (users.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = users[0];
    const isMatch = await bcrypt.compare(String(password), user.password);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign(
      { id: user.id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );
    res.json({ token, user: { id: user.id, name: user.name, role: user.role } });
  } catch (err) {
    console.error('[Auth Error] Login failure:', err);
    res.status(500).json({ error: 'Login failed due to a server error. Please try again.' });
  }
});

module.exports = router;
