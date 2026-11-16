const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');

// Load environment variables from cwd, with fallback to root .env
dotenv.config({ quiet: true });
if (!process.env.DB_HOST) {
  dotenv.config({ path: path.resolve(__dirname, '../.env'), quiet: true });
}

// Validate mandatory environment configuration
const requiredEnv = ['DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_NAME', 'JWT_SECRET'];
const missingEnv = requiredEnv.filter((key) => !process.env[key]);
if (missingEnv.length > 0) {
  console.error('\n=============================================================');
  console.error('❌ FATAL CONFIGURATION ERROR: Missing mandatory environment variable(s):');
  missingEnv.forEach((key) => console.error(`   - ${key}`));
  console.error('\nPlease copy .env.example to .env and configure the required settings.');
  console.error('=============================================================\n');
  process.exit(1);
}

const authRoutes = require('./routes/auth');
const complaintRoutes = require('./routes/complaints');
const { uploadsDir } = require('./middleware/upload');
const db = require('./models/db');

const app = express();
const server = http.createServer(app);

// Allowed origins for CORS and Socket.IO (supports single or comma-separated origins)
const defaultOrigins = ['http://localhost:3000', 'http://localhost'];
const configuredOrigins = process.env.CLIENT_URL
  ? process.env.CLIENT_URL.split(',').map((url) => url.trim()).filter(Boolean)
  : [];
const allowedOrigins = Array.from(new Set([...defaultOrigins, ...configuredOrigins]));

const io = new Server(server, {
  cors: { origin: allowedOrigins, methods: ['GET', 'POST', 'PATCH'] }
});

app.disable('x-powered-by');
app.use(cors({ origin: allowedOrigins }));
app.use(express.json({ limit: '100kb' }));

// Absolute path static serving for uploaded photographs
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}
app.use('/uploads', express.static(uploadsDir));

// Route handlers
app.use('/api/auth', authRoutes);
app.use('/api/complaints', complaintRoutes);

// Git commit of the running code (written into .env by the Ansible deployment); "dev" locally.
const APP_VERSION = process.env.APP_VERSION || 'dev';

// Health check used by Docker, Ansible, Jenkins and the start/status scripts.
// It runs a real query, so "healthy" means the API AND the database answer. 503 otherwise.
app.get('/api/health', async (req, res) => {
  const timestamp = new Date().toISOString();
  try {
    await db.query('SELECT 1');
    res.json({ status: 'CivicHelp backend is running', database: 'connected', version: APP_VERSION, timestamp });
  } catch (err) {
    console.error('[Health] Database check failed:', err.code || err.message);
    res.status(503).json({ status: 'CivicHelp backend is running', database: 'unavailable', version: APP_VERSION, timestamp });
  }
});

// Unknown API routes return JSON (not Express' HTML page)
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

io.on('connection', (socket) => {
  console.log('[Socket.IO] Client connected:', socket.id);
  socket.on('disconnect', () => console.log('[Socket.IO] Client disconnected:', socket.id));
});

app.set('io', io);

// Global fallback error handler. Client errors (e.g. malformed JSON -> 400) keep their message;
// server errors are logged but the client only gets a generic message (no internals leaked).
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = Number.isInteger(err.status) && err.status >= 400 && err.status < 600 ? err.status : 500;
  if (status >= 500) console.error('[Server Error]', err);
  const message = status < 500
    ? (err.type === 'entity.parse.failed' ? 'Request body is not valid JSON.' : (err.expose && err.message) || 'Bad request')
    : 'Internal server error';
  res.status(status).json({ error: message });
});

const PORT = process.env.PORT || 5001;
server.listen(PORT, () => console.log(`CivicHelp backend running on port ${PORT}`));
