import express from 'express';
import cookieParser from 'cookie-parser';
import jwt from 'jsonwebtoken';
import path from 'path';
import { config } from './config';
import { adminRouter } from './routes/admin';
import { requireAuth, COOKIE_NAME } from './middleware/auth';
import { dynamicProxy } from './middleware/dynamicProxy';
import { routeManager } from './lib/routeManager';
import { apiRouter } from './routes/api';

const app = express();

// Cookie parser is safe globally (reads headers only, doesn't touch the body)
app.use(cookieParser());

// JSON body parser applied ONLY to auth/api routes — NOT globally.
// Global express.json() would consume the request body stream before
// http-proxy-middleware can forward it, breaking binary uploads (files, MP3, etc.)
const jsonParser = express.json();

// ==========================================
// 1. Authentication Routes (No Proxy needed)
// ==========================================
app.get('/login', (req, res) => {
  res.sendFile(path.resolve(__dirname, '../src/views/login.html'));
});

app.get('/register', (req, res) => {
  res.sendFile(path.resolve(__dirname, '../src/views/register.html'));
});

app.post('/login', jsonParser, async (req, res) => {
  const { email, password } = req.body;

  // 1. Check if it's the master admin
  if (email === config.adminUsername && password === config.adminPassword) {
    const token = jwt.sign({ id: 'admin', email, role: 'ADMIN' }, config.jwtSecret, { expiresIn: '24h' });
    res.cookie(COOKIE_NAME, token, { httpOnly: true, secure: process.env.NODE_ENV === 'production' });
    res.json({ success: true, redirect: '/admin' });
    return;
  }

  // 2. Check registered users in the database
  try {
    const { prisma } = await import('./db');
    const bcrypt = await import('bcrypt');
    const user = await prisma.user.findUnique({ where: { email } });
    
    if (user && await bcrypt.compare(password, user.passwordHash)) {
      const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, config.jwtSecret, { expiresIn: '24h' });
      res.cookie(COOKIE_NAME, token, { httpOnly: true, secure: process.env.NODE_ENV === 'production' });
      
      // Admin goes to /admin, regular users go to a success page
      const redirect = user.role === 'ADMIN' ? '/admin' : '/login?success=1';
      res.json({ success: true, redirect });
      return;
    }
  } catch (err) {
    console.error('DB login check failed:', err);
  }

  res.status(401).json({ error: 'Invalid credentials' });
});

app.get('/logout', (req, res) => {
  res.clearCookie(COOKIE_NAME);
  res.redirect('/login');
});

// ==========================================
// 2. API & Admin Dashboard
// ==========================================
app.use('/api', jsonParser, apiRouter);
app.use('/admin', jsonParser, adminRouter);

// ==========================================
// 3. Dynamic Proxy (Catch-All)
// ==========================================
// Proxy catch-all: NO body parser here so binary streams pass through untouched
app.use(requireAuth, dynamicProxy);

// Start Server
routeManager.loadRoutes().then(() => {
  app.listen(config.port, () => {
    console.log(`🛡️ Auth Proxy Middleware running on port ${config.port}`);
    console.log(`👉 Dashboard accessible at http://localhost:${config.port}/admin`);
  });
});
