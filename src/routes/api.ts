import { Router, Request, Response } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { prisma } from '../db';
import { config } from '../config';
import fs from 'fs';
import express from 'express';

export const apiRouter = Router();
const jsonParser = express.json();

// End-user Registration
apiRouter.post('/register', jsonParser, async (req: Request, res: Response): Promise<void> => {
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

    const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, config.jwtSecret, { expiresIn: '24h' });
    res.cookie('auth_proxy_token', token, { httpOnly: true, secure: process.env.NODE_ENV === 'production' });
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// End-user Login (from Desktop App)
apiRouter.post('/login', jsonParser, async (req: Request, res: Response): Promise<void> => {
  const { email, password, publicKey } = req.body;
  
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

    // Register SSH Key if provided
    if (publicKey) {
      try {
        const restrictedKey = `command="/bin/false",no-pty,no-X11-forwarding,permitopen="localhost:*" ${publicKey}\n`;
        fs.appendFileSync('/usr/src/app/authorized_keys', restrictedKey);
      } catch (err) {
        console.error('Failed to write SSH key:', err);
      }
    }

    const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, config.jwtSecret, { expiresIn: '24h' });
    res.cookie('auth_proxy_token', token, { httpOnly: true, secure: process.env.NODE_ENV === 'production' });
    
    // Return VPS IP for the desktop app to connect to
    res.json({ success: true, vpsIp: process.env.VPS_IP || '127.0.0.1' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});
