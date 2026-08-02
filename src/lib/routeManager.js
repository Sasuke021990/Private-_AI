"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.routeManager = exports.RouteManager = void 0;
const fs_1 = __importDefault(require("fs"));
const config_1 = require("../config");
class RouteManager {
    routes = {};
    constructor() {
        this.loadRoutes();
    }
    loadRoutes() {
        try {
            if (fs_1.default.existsSync(config_1.config.routesFilePath)) {
                const data = fs_1.default.readFileSync(config_1.config.routesFilePath, 'utf-8');
                this.routes = JSON.parse(data);
            }
            else {
                this.routes = {};
            }
        }
        catch (error) {
            console.error('Failed to parse routes.json:', error);
            this.routes = {};
        }
    }
    getRoutes() {
        return this.routes;
    }
    getTarget(path) {
        // Find longest matching prefix
        const matchingPaths = Object.keys(this.routes).filter(prefix => path.startsWith(prefix));
        if (matchingPaths.length === 0)
            return null;
        matchingPaths.sort((a, b) => b.length - a.length);
        return this.routes[matchingPaths[0]];
    }
    addRoute(path, target) {
        this.routes[path] = target;
        this.saveRoutes();
    }
    deleteRoute(path) {
        if (this.routes[path]) {
            delete this.routes[path];
            this.saveRoutes();
        }
    }
    saveRoutes() {
        try {
            fs_1.default.writeFileSync(config_1.config.routesFilePath, JSON.stringify(this.routes, null, 2), 'utf-8');
        }
        catch (error) {
            console.error('Failed to save routes.json:', error);
            throw new Error('Could not persist routes.');
        }
    }
}
exports.RouteManager = RouteManager;
exports.routeManager = new RouteManager();
//# sourceMappingURL=routeManager.js.map