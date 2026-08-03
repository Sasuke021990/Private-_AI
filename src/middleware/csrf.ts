import { Request, Response, NextFunction } from 'express';

export const requireCsrf = (req: Request, res: Response, next: NextFunction): void => {
  const header = req.get('x-csrf-token');
  if (!header || header !== req.cookies.csrf_token) {
    console.warn(`[CSRF] rejected ${req.method} ${req.originalUrl} — header present: ${!!header}, cookie present: ${!!req.cookies.csrf_token}, match: ${header === req.cookies.csrf_token}`);
    res.status(403).json({ error: 'CSRF check failed' });
    return;
  }
  next();
};
