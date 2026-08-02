import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';

export const COOKIE_NAME = 'auth_proxy_token';

export const requireAuth = (req: Request, res: Response, next: NextFunction): void => {
  const token = req.cookies[COOKIE_NAME];

  if (!token) {
    if (req.path.startsWith('/admin/api')) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    res.redirect('/login');
    return;
  }

  try {
    jwt.verify(token, config.jwtSecret);
    next();
  } catch (error) {
    if (req.path.startsWith('/admin/api')) {
      res.status(401).json({ error: 'Invalid or expired token' });
      return;
    }
    res.redirect('/login');
  }
};
