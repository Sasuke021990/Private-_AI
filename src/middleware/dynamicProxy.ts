import { Request, Response, NextFunction } from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { routeManager } from '../lib/routeManager';

export const dynamicProxy = (req: Request, res: Response, next: NextFunction): void => {
  let target = routeManager.getTarget(req.path);
  let matchedPrefix = Object.keys(routeManager.getRoutes())
    .filter(prefix => req.path.startsWith(prefix))
    .sort((a, b) => b.length - a.length)[0];

  // MAGIC REFERER HACK: If no target, try inferring from Referer header for 'app' routes
  if (!target && req.headers.referer) {
    try {
      const refererUrl = new URL(req.headers.referer);
      const refererPrefix = Object.keys(routeManager.getRoutes())
        .filter(prefix => refererUrl.pathname.startsWith(prefix))
        .sort((a, b) => b.length - a.length)[0];
      
      if (refererPrefix) {
        const config = routeManager.getRouteConfig(refererPrefix);
        if (config && config.type === 'app') {
          target = config.target;
        }
      }
    } catch (e) {
      // invalid referer url, ignore
    }
  }

  if (!target) {
    if (!req.path.startsWith('/admin') && !req.path.startsWith('/login')) {
       res.status(404).send('Not Found: No proxy route configured for this path.');
       return;
    }
    next();
    return;
  }

  const pathRewrite: Record<string, string> = {};
  if (matchedPrefix && req.path.startsWith(matchedPrefix)) {
    pathRewrite[`^${matchedPrefix}`] = ''; // only strip if path literally starts with prefix
  }

  const proxy = createProxyMiddleware({
    target,
    changeOrigin: true,
    ws: true,
    pathRewrite,
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
