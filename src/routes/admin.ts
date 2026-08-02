import { Router, Request, Response } from 'express';
import { routeManager } from '../lib/routeManager';
import { requireAuth } from '../middleware/auth';
import path from 'path';
import { jsonParser } from '../index';

export const adminRouter = Router();

// Protect all /admin routes
adminRouter.use(requireAuth);

// Render Dashboard UI
adminRouter.get('/', (req: Request, res: Response) => {
  res.sendFile(path.resolve(__dirname, '../../src/views/dashboard.html'));
});

// API: Get all routes
adminRouter.get('/api/routes', (req: Request, res: Response) => {
  res.json(routeManager.getRoutes());
});

// API: Add or Update route
adminRouter.post('/api/routes', jsonParser, (req: Request, res: Response) => {
  const { path, target, type } = req.body;
  if (!path || !target) {
    res.status(400).json({ error: 'Path and target are required' });
    return;
  }
  
  if (!path.startsWith('/')) {
    res.status(400).json({ error: 'Path must start with /' });
    return;
  }

  // Only ADMIN can assign arbitrary user IDs, otherwise use own ID
  const userId = req.user.role === 'ADMIN' ? (req.body.userId || req.user.id) : req.user.id;

  routeManager.addRoute(path, target, type === 'app' ? 'app' : 'api', userId)
    .then(() => res.json({ success: true, routes: routeManager.getRoutes() }))
    .catch(err => res.status(500).json({ error: err.message }));
});

// API: Delete route
adminRouter.delete('/api/routes', jsonParser, (req: Request, res: Response) => {
  const { path } = req.body;
  if (!path) {
    res.status(400).json({ error: 'Path is required' });
    return;
  }

  // Security: only allow deleting own routes or if ADMIN
  const route = routeManager.getRouteConfig(path);
  if (route && route.userId !== req.user.id && req.user.role !== 'ADMIN') {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }

  routeManager.deleteRoute(path)
    .then(() => res.json({ success: true, routes: routeManager.getRoutes() }))
    .catch(err => res.status(500).json({ error: err.message }));
});

import { prisma } from '../db';
// API: Get Users (ADMIN ONLY)
adminRouter.get('/api/users', async (req: Request, res: Response) => {
  if (req.user.role !== 'ADMIN') return res.status(403).json({ error: 'Forbidden' });
  const users = await prisma.user.findMany({ select: { id: true, email: true, role: true, createdAt: true }});
  res.json(users);
});
