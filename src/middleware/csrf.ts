import { Request, Response, NextFunction } from 'express';

export const requireCsrf = (req: Request, res: Response, next: NextFunction): void => {
  const header = req.get('x-csrf-token');
  if (!header || header !== req.cookies.csrf_token) {
    res.status(403).json({ error: 'CSRF check failed' });
    return;
  }
  next();
};
