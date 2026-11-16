#!/usr/bin/env node
/**
 * Create (or update) a CivicHelp staff account.
 *
 * Public registration always creates citizens, so ward officers and field
 * workers are provisioned by an administrator with this script.
 *
 * Usage (inside the running backend container):
 *   docker compose exec backend node scripts/create-staff.js <officer|worker> "<Full Name>" <email> <password>
 *
 * Add --reset-password to change the password/role of an existing account.
 */
const path = require('path');
const bcrypt = require('bcryptjs');
const dotenv = require('dotenv');

dotenv.config({ quiet: true });
if (!process.env.DB_HOST) {
  dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });
}

const db = require('../models/db');

const args = process.argv.slice(2);
const reset = args.includes('--reset-password');
const [role, name, email, password] = args.filter((a) => a !== '--reset-password');

const usage = () => {
  console.error('Usage: node scripts/create-staff.js <officer|worker> "<Full Name>" <email> <password> [--reset-password]');
  process.exit(1);
};

(async () => {
  if (!['officer', 'worker'].includes(role) || !name || !email || !password) usage();
  if (password.length < 6) {
    console.error('Password must be at least 6 characters.');
    process.exit(1);
  }

  try {
    const hash = await bcrypt.hash(password, 10);
    const [existing] = await db.query('SELECT id, role FROM users WHERE email = ?', [email]);

    if (existing.length > 0) {
      if (!reset) {
        console.log(`Account ${email} already exists (role: ${existing[0].role}). Use --reset-password to update it.`);
        process.exit(0);
      }
      await db.query('UPDATE users SET name = ?, password = ?, role = ? WHERE id = ?', [name, hash, role, existing[0].id]);
      console.log(`Updated ${role} account: ${email}`);
    } else {
      await db.query('INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)', [name, email, hash, role]);
      console.log(`Created ${role} account: ${email}`);
    }
    process.exit(0);
  } catch (err) {
    console.error('Failed to create staff account:', err.message);
    process.exit(1);
  }
})();
