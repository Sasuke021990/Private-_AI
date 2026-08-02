"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.config = void 0;
const dotenv_1 = __importDefault(require("dotenv"));
const path_1 = __importDefault(require("path"));
dotenv_1.default.config();
exports.config = {
    port: parseInt(process.env.PORT || '4000', 10),
    jwtSecret: process.env.JWT_SECRET || 'fallback_secret',
    adminUsername: process.env.ADMIN_USERNAME || 'admin',
    adminPassword: process.env.ADMIN_PASSWORD || 'admin',
    routesFilePath: path_1.default.resolve(__dirname, '../../routes.json'),
};
if (!process.env.JWT_SECRET) {
    console.warn('⚠️ WARNING: JWT_SECRET is not set in .env. Using fallback secret.');
}
//# sourceMappingURL=config.js.map