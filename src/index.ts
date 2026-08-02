import express from 'express';
import cookieParser from 'cookie-parser';
import jwt from 'jsonwebtoken';
import path from 'path';
import { config } from './config';
import { adminRouter } from './routes/admin';
import { requireAuth, COOKIE_NAME } from './middleware/auth';
import { dynamicProxy } from './middleware/dynamicProxy';

const app = express();

// Parsers for auth & API
app.use(cookieParser());
app.use(express.json());

// ==========================================
// 1. Authentication Routes (No Proxy needed)
// ==========================================
app.get('/login', (req, res) => {
  res.sendFile(path.resolve(__dirname, '../src/views/login.html'));
});

app.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (username === config.adminUsername && password === config.adminPassword) {
    const token = jwt.sign({ user: username }, config.jwtSecret, { expiresIn: '24h' });
    res.cookie(COOKIE_NAME, token, { httpOnly: true, secure: process.env.NODE_ENV === 'production' });
    res.json({ success: true });
  } else {
    res.status(401).json({ error: 'Invalid credentials' });
  }
});

app.get('/logout', (req, res) => {
  res.clearCookie(COOKIE_NAME);
  res.redirect('/login');
});

// ==========================================
// 2. Admin Dashboard APIs
// ==========================================
app.use('/admin', adminRouter);

// ==========================================
// 3. Dynamic Proxy (Catch-All)
// ==========================================
// If a user hits a route that isn't /login or /admin, the dynamicProxy intercepts.
// We apply the requireAuth middleware FIRST so random public traffic gets bounced to /login
app.use('*', (req, res, next) => {
  // We don't want to break the proxy's body streaming, 
  // but express.json() is already above. We only use proxy on undefined routes.
  next();
}, requireAuth, dynamicProxy);

// Start Server
app.listen(config.port, () => {
  console.log(`🛡️ Auth Proxy Middleware running on port ${config.port}`);
  console.log(`👉 Dashboard accessible at http://localhost:${config.port}/admin`);
});
