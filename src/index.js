"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cookie_parser_1 = __importDefault(require("cookie-parser"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const path_1 = __importDefault(require("path"));
const config_1 = require("./config");
const admin_1 = require("./routes/admin");
const auth_1 = require("./middleware/auth");
const dynamicProxy_1 = require("./middleware/dynamicProxy");
const app = (0, express_1.default)();
// Parsers for auth & API
app.use((0, cookie_parser_1.default)());
app.use(express_1.default.json());
// ==========================================
// 1. Authentication Routes (No Proxy needed)
// ==========================================
app.get('/login', (req, res) => {
    res.sendFile(path_1.default.resolve(__dirname, '../src/views/login.html'));
});
app.post('/login', (req, res) => {
    const { username, password } = req.body;
    if (username === config_1.config.adminUsername && password === config_1.config.adminPassword) {
        const token = jsonwebtoken_1.default.sign({ user: username }, config_1.config.jwtSecret, { expiresIn: '24h' });
        res.cookie(auth_1.COOKIE_NAME, token, { httpOnly: true, secure: process.env.NODE_ENV === 'production' });
        res.json({ success: true });
    }
    else {
        res.status(401).json({ error: 'Invalid credentials' });
    }
});
app.get('/logout', (req, res) => {
    res.clearCookie(auth_1.COOKIE_NAME);
    res.redirect('/login');
});
// ==========================================
// 2. Admin Dashboard APIs
// ==========================================
app.use('/admin', admin_1.adminRouter);
// ==========================================
// 3. Dynamic Proxy (Catch-All)
// ==========================================
// If a user hits a route that isn't /login or /admin, the dynamicProxy intercepts.
// We apply the requireAuth middleware FIRST so random public traffic gets bounced to /login
app.use('*', (req, res, next) => {
    // We don't want to break the proxy's body streaming, 
    // but express.json() is already above. We only use proxy on undefined routes.
    next();
}, auth_1.requireAuth, dynamicProxy_1.dynamicProxy);
// Start Server
app.listen(config_1.config.port, () => {
    console.log(`🛡️ Auth Proxy Middleware running on port ${config_1.config.port}`);
    console.log(`👉 Dashboard accessible at http://localhost:${config_1.config.port}/admin`);
});
//# sourceMappingURL=index.js.map