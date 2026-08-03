import { Router, Request, Response } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import rateLimit from 'express-rate-limit';
import { prisma } from '../db';
import { config } from '../config';
import express from 'express';

export const apiRouter = Router();
const jsonParser = express.json();

const registerLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 5, standardHeaders: true, legacyHeaders: false });
const loginLimiter = rateLimit({ windowMs: 5 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false });

function issueSessionCookies(res: Response, token: string) {
  const secure = process.env.NODE_ENV === 'production';
  res.cookie('auth_proxy_token', token, { httpOnly: true, secure, sameSite: 'lax' });
  res.cookie('csrf_token', crypto.randomBytes(32).toString('hex'), { httpOnly: false, secure, sameSite: 'lax' });
}

// End-user Registration
apiRouter.post('/register', registerLimiter, jsonParser, async (req: Request, res: Response): Promise<void> => {
  const { email, password } = req.body;
  if (!email || !password) {
    res.status(400).json({ error: 'Email and password required' });
    return;
  }

  try {
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      res.status(400).json({ error: 'Email already registered' });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: { email, passwordHash, role: 'USER' }
    });

    const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, config.jwtSecret, { expiresIn: '24h', jwtid: crypto.randomUUID() });
    issueSessionCookies(res, token);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// End-user Login (from Desktop App)
// Note: SSH public key registration is NOT handled here anymore — it's tied to a specific
// route/port at `POST /admin/api/routes` time (src/lib/sshKeyManager.ts) so `permitopen`
// can be scoped to that route's port instead of allowing access to any local port.
apiRouter.post('/login', loginLimiter, jsonParser, async (req: Request, res: Response): Promise<void> => {
  const { email, password } = req.body;

  if (!email || !password) {
    res.status(400).json({ error: 'Email and password required' });
    return;
  }

  try {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, config.jwtSecret, { expiresIn: '24h', jwtid: crypto.randomUUID() });
    issueSessionCookies(res, token);

    // Return VPS IP for the desktop app to connect to
    res.json({ success: true, vpsIp: process.env.VPS_IP || '127.0.0.1' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});
