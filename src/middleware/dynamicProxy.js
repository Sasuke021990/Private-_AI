"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.dynamicProxy = void 0;
const express_1 = require("express");
const http_proxy_middleware_1 = require("http-proxy-middleware");
const routeManager_1 = require("../lib/routeManager");
const dynamicProxy = (req, res, next) => {
    const target = routeManager_1.routeManager.getTarget(req.path);
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
    const matchedPrefix = Object.keys(routeManager_1.routeManager.getRoutes())
        .filter(prefix => req.path.startsWith(prefix))
        .sort((a, b) => b.length - a.length)[0];
    const proxy = (0, http_proxy_middleware_1.createProxyMiddleware)({
        target,
        changeOrigin: true,
        ws: true,
        pathRewrite: {
            [`^${matchedPrefix}`]: '', // strip prefix
        },
        logLevel: 'silent',
        onError: (err, req, res) => {
            console.error(`Proxy error for ${target}:`, err);
            if (!res.headersSent) {
                res.status(502).send('Bad Gateway: Target is unreachable.');
            }
        }
    });
    proxy(req, res, next);
};
exports.dynamicProxy = dynamicProxy;
//# sourceMappingURL=dynamicProxy.js.map