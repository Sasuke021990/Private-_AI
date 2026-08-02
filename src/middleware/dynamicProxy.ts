import { Request, Response, NextFunction } from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { routeManager } from '../lib/routeManager';

export const dynamicProxy = (req: Request, res: Response, next: NextFunction): void => {
  const target = routeManager.getTarget(req.path);

  if (!target) {
    // If no route matches, and it's not an admin/login route, return 404
    if (!req.path.startsWith('/admin') && !req.path.startsWith('/login')) {
       res.status(404).send('Not Found: No proxy route configured for this path.');
       return;
    }
    next();
    return;
  }

  // Find the matched prefix to rewrite it (e.g., /ai -> /)
  const matchedPrefix = Object.keys(routeManager.getRoutes())
    .filter(prefix => req.path.startsWith(prefix))
    .sort((a, b) => b.length - a.length)[0];

  const proxy = createProxyMiddleware({
    target,
    changeOrigin: true,
    ws: true,
    pathRewrite: {
      [`^${matchedPrefix}`]: '', // strip prefix
    },
    on: {
      error: (err: any, req: any, res: any) => {
        console.error(`Proxy error for ${target}:`, err);
        if (res.headersSent === false) {
          res.status(502).send('Bad Gateway: Target is unreachable.');
        }
      }
    }
  });

  proxy(req, res, next);
};
