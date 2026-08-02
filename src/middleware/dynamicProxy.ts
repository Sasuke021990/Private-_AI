import { Request, Response, NextFunction } from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { routeManager } from '../lib/routeManager';

// Custom router to determine target dynamically
const customRouter = (req: any) => {
  let target = routeManager.getTarget(req.url);

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
  
  return target || 'http://127.0.0.1:65535'; // Return dummy target if not found, we'll intercept and 404 it
};

// The proxy singleton
export const dynamicProxy = createProxyMiddleware({
  target: 'http://127.0.0.1:65535', // Dummy fallback target
  router: customRouter,
  changeOrigin: true,
  ws: true, // Enable WebSocket proxying!
  pathRewrite: (path, req) => {
    const matchedPrefix = Object.keys(routeManager.getRoutes())
      .filter(prefix => path.startsWith(prefix))
      .sort((a, b) => b.length - a.length)[0];
    
    if (matchedPrefix) {
      return path.replace(new RegExp(`^${matchedPrefix}`), '');
    }
    return path;
  },
  on: {
    error: (err: any, req: any, res: any) => {
      // If we routed to the dummy target because no route was found
      if (err.code === 'ECONNREFUSED' && err.port === 65535) {
        if (!req.url.startsWith('/admin') && !req.url.startsWith('/login')) {
          res.status(404).send('Not Found: No proxy route configured for this path.');
          return;
        }
      }
      console.error(`Proxy error for ${req.url}:`, err);
      if (res && res.headersSent === false) {
        res.status(502).send('Bad Gateway: Target is unreachable.');
      }
    }
  }
});
