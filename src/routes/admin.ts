import { Router, Request, Response } from 'express';
import { routeManager } from '../lib/routeManager';
import { requireAuth } from '../middleware/auth';
import { requireCsrf } from '../middleware/csrf';
import { canAccessRoute } from '../lib/authz';
import { registerKeyForRoute, revokeKeyForRoute } from '../lib/sshKeyManager';
import path from 'path';
import express from 'express';

export const adminRouter = Router();
const jsonParser = express.json();

// Protect all /admin routes
adminRouter.use(requireAuth);

// Render Dashboard UI
adminRouter.get('/', (req: Request, res: Response) => {
  res.sendFile(path.resolve(__dirname, '../../src/views/dashboard.html'));
});

// API: Get routes visible to the caller (all routes for ADMIN, own routes only otherwise)
adminRouter.get('/api/routes', (req: Request, res: Response) => {
  const all = routeManager.getRoutes();
  if (req.user.role === 'ADMIN') {
    res.json(all);
    return;
  }
  const visible = Object.fromEntries(Object.entries(all).filter(([, r]) => canAccessRoute(req.user, r)));
  res.json(visible);
});

// API: Add or Update route
adminRouter.post('/api/routes', jsonParser, requireCsrf, async (req: Request, res: Response) => {
  const { path, target, type, publicKey } = req.body;
  if (!path || !target) {
    res.status(400).json({ error: 'Path and target are required' });
    return;
  }

  if (!path.startsWith('/')) {
    res.status(400).json({ error: 'Path must start with /' });
    return;
  }

  // A path already owned by a different tenant cannot be silently reassigned
  const existing = routeManager.getRouteConfig(path);
  if (existing && !canAccessRoute(req.user, existing)) {
    res.status(409).json({ error: 'Path already registered by another account.' });
    return;
  }

  // Only ADMIN can assign arbitrary user IDs, otherwise use own ID
  const userId = req.user.role === 'ADMIN' ? (req.body.userId || req.user.id) : req.user.id;

  try {
    const route = await routeManager.addRoute(path, target, type === 'app' ? 'app' : 'api', userId);

    if (publicKey) {
      let port: string;
      try {
        port = new URL(target).port;
        if (!port) throw new Error('no port');
      } catch {
        res.status(400).json({ error: 'Target must include an explicit port to register an SSH tunnel key.' });
        return;
      }
      await registerKeyForRoute(route.id, publicKey, port);
    }

    res.json({ success: true, routes: routeManager.getRoutes() });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// API: Delete route
adminRouter.delete('/api/routes', jsonParser, requireCsrf, async (req: Request, res: Response) => {
  const { path } = req.body;
  if (!path) {
    res.status(400).json({ error: 'Path is required' });
    return;
  }

  // Security: only allow deleting own routes or if ADMIN
  const route = routeManager.getRouteConfig(path);
  if (route && !canAccessRoute(req.user, route)) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }

  try {
    await routeManager.deleteRoute(path);
    if (route) {
      await revokeKeyForRoute(route.id);
    }
    res.json({ success: true, routes: routeManager.getRoutes() });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

import { prisma } from '../db';
// API: Get Users (ADMIN ONLY)
adminRouter.get('/api/users', async (req: Request, res: Response) => {
  if (req.user.role !== 'ADMIN') return res.status(403).json({ error: 'Forbidden' });
  const users = await prisma.user.findMany({ select: { id: true, email: true, role: true, createdAt: true }});
  res.json(users);
});
