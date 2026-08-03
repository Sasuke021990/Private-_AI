import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { revokedTokenManager } from '../lib/revokedTokenManager';

export const COOKIE_NAME = 'auth_proxy_token';

declare global {
  namespace Express {
    interface Request {
      user?: any;
    }
  }
}

export const requireAuth = (req: Request, res: Response, next: NextFunction): void => {
  const token = req.cookies[COOKIE_NAME];

  if (!token) {
    if (req.originalUrl.startsWith('/admin/api')) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    res.redirect('/login');
    return;
  }

  try {
    const payload: any = jwt.verify(token, config.jwtSecret);
    if (revokedTokenManager.isRevoked(payload.jti)) {
      if (req.originalUrl.startsWith('/admin/api')) {
        res.status(401).json({ error: 'Invalid or expired token' });
        return;
      }
      res.redirect('/login');
      return;
    }
    req.user = payload;
    next();
  } catch (error) {
    if (req.originalUrl.startsWith('/admin/api')) {
      res.status(401).json({ error: 'Invalid or expired token' });
      return;
    }
    res.redirect('/login');
  }
};
