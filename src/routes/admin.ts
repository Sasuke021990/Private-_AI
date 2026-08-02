import { Router, Request, Response } from 'express';
import { routeManager } from '../lib/routeManager';
import { requireAuth } from '../middleware/auth';
import path from 'path';

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
adminRouter.post('/api/routes', (req: Request, res: Response) => {
  const { path, target, type } = req.body;
  if (!path || !target) {
    res.status(400).json({ error: 'Path and target are required' });
    return;
  }
  
  if (!path.startsWith('/')) {
    res.status(400).json({ error: 'Path must start with /' });
    return;
  }

  routeManager.addRoute(path, target, type === 'app' ? 'app' : 'api');
  res.json({ success: true, routes: routeManager.getRoutes() });
});

// API: Delete route
adminRouter.delete('/api/routes', (req: Request, res: Response) => {
  const { path } = req.body;
  if (!path) {
    res.status(400).json({ error: 'Path is required' });
    return;
  }

  routeManager.deleteRoute(path);
  res.json({ success: true, routes: routeManager.getRoutes() });
});
