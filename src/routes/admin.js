"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.adminRouter = void 0;
const express_1 = require("express");
const routeManager_1 = require("../lib/routeManager");
const auth_1 = require("../middleware/auth");
const path_1 = __importDefault(require("path"));
exports.adminRouter = (0, express_1.Router)();
// Protect all /admin routes
exports.adminRouter.use(auth_1.requireAuth);
// Render Dashboard UI
exports.adminRouter.get('/', (req, res) => {
    res.sendFile(path_1.default.resolve(__dirname, '../../src/views/dashboard.html'));
});
// API: Get all routes
exports.adminRouter.get('/api/routes', (req, res) => {
    res.json(routeManager_1.routeManager.getRoutes());
});
// API: Add or Update route
exports.adminRouter.post('/api/routes', (req, res) => {
    const { path, target } = req.body;
    if (!path || !target) {
        res.status(400).json({ error: 'Path and target are required' });
        return;
    }
    if (!path.startsWith('/')) {
        res.status(400).json({ error: 'Path must start with /' });
        return;
    }
    routeManager_1.routeManager.addRoute(path, target);
    res.json({ success: true, routes: routeManager_1.routeManager.getRoutes() });
});
// API: Delete route
exports.adminRouter.delete('/api/routes', (req, res) => {
    const { path } = req.body;
    if (!path) {
        res.status(400).json({ error: 'Path is required' });
        return;
    }
    routeManager_1.routeManager.deleteRoute(path);
    res.json({ success: true, routes: routeManager_1.routeManager.getRoutes() });
});
//# sourceMappingURL=admin.js.map