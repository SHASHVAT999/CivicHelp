const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');

// Load environment variables from cwd, with fallback to root .env
dotenv.config();
if (!process.env.DB_HOST) {
  dotenv.config({ path: path.resolve(__dirname, '../.env') });
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

app.use(cors({ origin: allowedOrigins }));
app.use(express.json());

// Absolute path static serving for uploaded photographs
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}
app.use('/uploads', express.static(uploadsDir));

// Route handlers
app.use('/api/auth', authRoutes);
app.use('/api/complaints', complaintRoutes);

app.get('/api/health', (req, res) => {
  res.json({
    status: 'CivicHelp backend is running ✅',
    timestamp: new Date().toISOString()
  });
});

io.on('connection', (socket) => {
  console.log('[Socket.IO] Client connected:', socket.id);
  socket.on('disconnect', () => console.log('[Socket.IO] Client disconnected:', socket.id));
});

app.set('io', io);

// Global fallback error handler
app.use((err, req, res, next) => {
  console.error('[Server Error]', err);
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error'
  });
});

const PORT = process.env.PORT || 5001;
server.listen(PORT, () => console.log(`CivicHelp backend running on port ${PORT}`));
