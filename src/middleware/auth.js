"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireAuth = exports.COOKIE_NAME = void 0;
const express_1 = require("express");
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const config_1 = require("../config");
exports.COOKIE_NAME = 'auth_proxy_token';
const requireAuth = (req, res, next) => {
    const token = req.cookies[exports.COOKIE_NAME];
    if (!token) {
        if (req.path.startsWith('/admin/api')) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }
        res.redirect('/login');
        return;
    }
    try {
        jsonwebtoken_1.default.verify(token, config_1.config.jwtSecret);
        next();
    }
    catch (error) {
        if (req.path.startsWith('/admin/api')) {
            res.status(401).json({ error: 'Invalid or expired token' });
            return;
        }
        res.redirect('/login');
    }
};
exports.requireAuth = requireAuth;
//# sourceMappingURL=auth.js.map