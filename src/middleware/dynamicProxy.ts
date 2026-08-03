import { createProxyMiddleware } from 'http-proxy-middleware';
import { routeManager, RouteConfig } from '../lib/routeManager';
import { canAccessRoute } from '../lib/authz';

type Match = { prefix: string; config: RouteConfig };

function findMatch(req: any): Match | null {
  const direct = routeManager.matchRoute(req.url);
  if (direct) return direct;

  // MAGIC REFERER HACK: If no direct match, try inferring from Referer header for 'app' routes
  if (req.headers.referer) {
    try {
      const refererUrl = new URL(req.headers.referer);
      const refererMatch = routeManager.matchRoute(refererUrl.pathname);
      if (refererMatch && refererMatch.config.type === 'app') {
        return refererMatch;
      }
    } catch (e) {
      // invalid referer url, ignore
    }
  }

  return null;
}

// Resolves the target route AND enforces that the requester owns it (or is ADMIN).
// Used by both the HTTP router and pathRewrite so the two can't disagree, and by
// on.error to distinguish "no route configured" (404) from "not your route" (403).
function resolveAndAuthorize(req: any): Match | null {
  const match = findMatch(req);
  if (!match) return null;

  if (!canAccessRoute(req.user, match.config)) {
    req.__routeAuthDenied = true;
    return null;
  }

  req.__matchedRoute = match;
  return match;
}

// Custom router to determine target dynamically
const customRouter = (req: any) => {
  const match = resolveAndAuthorize(req);
  return match?.config.target || 'http://127.0.0.1:65535'; // Dummy target if not found/denied, we'll intercept and 404/403 it
};

// The proxy singleton
export const dynamicProxy = createProxyMiddleware({
  target: 'http://127.0.0.1:65535', // Dummy fallback target
  router: customRouter,
  changeOrigin: true,
  ws: true, // Enable WebSocket proxying!
  pathRewrite: (path, req: any) => {
    const matchedPrefix = req.__matchedRoute?.prefix;
    if (matchedPrefix) {
      return path.replace(new RegExp(`^${matchedPrefix}`), '');
    }
    return path;
  },
  on: {
    // NOTE: for WebSocket upgrade errors, `res` is a raw net.Socket, not an Express
    // Response — it has no .status()/.send(). Must branch on that before calling
    // Express-only methods, or an upgrade-path error crashes the whole process.
    error: (err: any, req: any, res: any) => {
      const isSocket = typeof res?.status !== 'function';

      const writeRawHttpError = (statusCode: number, statusText: string, message: string) => {
        if (!res.writable) return;
        res.end(`HTTP/1.1 ${statusCode} ${statusText}\r\nConnection: close\r\nContent-Type: text/plain\r\n\r\n${message}`);
      };

      // If we routed to the dummy target because no route was found or access was denied
      if (err.code === 'ECONNREFUSED' && err.port === 65535) {
        if (!req.url.startsWith('/admin') && !req.url.startsWith('/login')) {
          const denied = !!req.__routeAuthDenied;
          const statusCode = denied ? 403 : 404;
          const message = denied ? 'Forbidden: you do not own this route.' : 'Not Found: No proxy route configured for this path.';
          if (isSocket) {
            writeRawHttpError(statusCode, denied ? 'Forbidden' : 'Not Found', message);
          } else {
            res.status(statusCode).send(message);
          }
          return;
        }
      }

      console.error(`Proxy error for ${req.url}:`, err);
      if (isSocket) {
        writeRawHttpError(502, 'Bad Gateway', 'Bad Gateway: Target is unreachable.');
      } else if (res && res.headersSent === false) {
        res.status(502).send('Bad Gateway: Target is unreachable.');
      }
    }
  }
});
