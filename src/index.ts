import express from 'express';
import cookieParser from 'cookie-parser';
import { parseCookie } from 'cookie';
import jwt from 'jsonwebtoken';
import path from 'path';
import crypto from 'crypto';
import rateLimit from 'express-rate-limit';
import { config } from './config';
import { adminRouter } from './routes/admin';
import { requireAuth, COOKIE_NAME } from './middleware/auth';
import { dynamicProxy } from './middleware/dynamicProxy';
import { routeManager } from './lib/routeManager';
import { revokedTokenManager } from './lib/revokedTokenManager';
import { revokeAllKeysForUser } from './lib/sshKeyManager';
import { apiRouter } from './routes/api';

const app = express();

const loginLimiter = rateLimit({ windowMs: 5 * 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false });

// Cookie parser is safe globally (reads headers only, doesn't touch the body)
app.use(cookieParser());

// ==========================================
// 1. Authentication Routes (No Proxy needed)
// ==========================================
app.get('/login', (req, res) => {
  res.sendFile(path.resolve(__dirname, '../src/views/login.html'));
});

app.get('/register', (req, res) => {
  res.sendFile(path.resolve(__dirname, '../src/views/register.html'));
});

function issueSessionCookies(res: express.Response, token: string) {
  const secure = process.env.NODE_ENV === 'production';
  res.cookie(COOKIE_NAME, token, { httpOnly: true, secure, sameSite: 'lax' });
  res.cookie('csrf_token', crypto.randomBytes(32).toString('hex'), { httpOnly: false, secure, sameSite: 'lax' });
}

app.post('/login', loginLimiter, express.json(), async (req, res) => {
  const { email, password } = req.body;

  // 1. Check if it's the master admin
  if (email === config.adminUsername && password === config.adminPassword) {
    const token = jwt.sign({ id: 'admin', email, role: 'ADMIN' }, config.jwtSecret, { expiresIn: '24h', jwtid: crypto.randomUUID() });
    issueSessionCookies(res, token);
    res.json({ success: true, redirect: '/admin' });
    return;
  }

  // 2. Check registered users in the database
  try {
    const { prisma } = await import('./db');
    const bcrypt = await import('bcrypt');
    const user = await prisma.user.findUnique({ where: { email } });

    if (user && await bcrypt.compare(password, user.passwordHash)) {
      const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, config.jwtSecret, { expiresIn: '24h', jwtid: crypto.randomUUID() });
      issueSessionCookies(res, token);

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

app.get('/logout', async (req, res) => {
  const token = req.cookies[COOKIE_NAME];
  if (token) {
    try {
      const payload: any = jwt.verify(token, config.jwtSecret);
      await revokedTokenManager.revoke(payload.jti, new Date(payload.exp * 1000));
      await revokeAllKeysForUser(payload.id);
    } catch {
      // invalid/expired token — nothing to revoke
    }
  }
  res.clearCookie(COOKIE_NAME);
  res.clearCookie('csrf_token');
  res.redirect('/login');
});

// ==========================================
// 2. API & Admin Dashboard
// ==========================================
// We do NOT apply jsonParser here globally because it would intercept
// any proxied request that happens to start with /api or /admin.
app.use('/api', apiRouter);
app.use('/admin', adminRouter);

// ==========================================
// 3. Dynamic Proxy (Catch-All)
// ==========================================
// Proxy catch-all: NO body parser here so binary streams pass through untouched
app.use(requireAuth, dynamicProxy);

// Start Server
Promise.all([routeManager.loadRoutes(), revokedTokenManager.load()]).then(() => {
  const server = app.listen(config.port, () => {
    console.log(`🛡️ Auth Proxy Middleware running on port ${config.port}`);
    console.log(`👉 Dashboard accessible at http://localhost:${config.port}/admin`);
  });

  // Bind WebSocket upgrade event to the proxy! Upgrade requests never go through
  // Express's middleware pipeline, so requireAuth never runs for them on its own —
  // verify the session cookie here before delegating to the proxy.
  server.on('upgrade', (req, socket, head) => {
    const cookies = parseCookie(req.headers.cookie || '');
    const token = cookies[COOKIE_NAME];
    let user: any;
    try {
      user = token ? jwt.verify(token, config.jwtSecret) : undefined;
    } catch {
      user = undefined;
    }

    if (!user || revokedTokenManager.isRevoked(user.jti)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    (req as any).user = user;
    // @ts-ignore
    dynamicProxy.upgrade(req, socket, head);
  });


  // Prevent Node.js from killing long-running proxy connections (like TTS generation)
  // Default keepAliveTimeout is 5 seconds. Increase to 5 minutes.
  server.keepAliveTimeout = 300000;
  server.headersTimeout = 301000;
  server.timeout = 300000;
});
