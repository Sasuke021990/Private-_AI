import fs from 'fs';
import { config } from '../config';

export interface RouteConfig {
  target: string;
  type: 'app' | 'api';
}

export type ProxyRoutes = Record<string, RouteConfig | string>;

export class RouteManager {
  private routes: ProxyRoutes = {};

  constructor() {
    this.loadRoutes();
  }

  public loadRoutes(): void {
    try {
      if (fs.existsSync(config.routesFilePath)) {
        const data = fs.readFileSync(config.routesFilePath, 'utf-8');
        this.routes = JSON.parse(data);
      } else {
        this.routes = {};
      }
    } catch (error) {
      console.error('Failed to parse routes.json:', error);
      this.routes = {};
    }
  }

  public getRoutes(): ProxyRoutes {
    return this.routes;
  }

  public getTarget(path: string): string | null {
    // Find longest matching prefix
    const matchingPaths = Object.keys(this.routes).filter(prefix => path.startsWith(prefix));
    if (matchingPaths.length === 0) return null;

    matchingPaths.sort((a, b) => b.length - a.length);
    const route = this.routes[matchingPaths[0]];
    if (typeof route === 'string') return route;
    return route.target;
  }

  public getRouteConfig(path: string): RouteConfig | null {
    const route = this.routes[path];
    if (!route) return null;
    if (typeof route === 'string') return { target: route, type: 'api' };
    return route;
  }

  public addRoute(path: string, target: string, type: 'app' | 'api' = 'api'): void {
    this.routes[path] = { target, type };
    this.saveRoutes();
  }

  public deleteRoute(path: string): void {
    if (this.routes[path]) {
      delete this.routes[path];
      this.saveRoutes();
    }
  }

  private saveRoutes(): void {
    try {
      fs.writeFileSync(config.routesFilePath, JSON.stringify(this.routes, null, 2), 'utf-8');
    } catch (error) {
      console.error('Failed to save routes.json:', error);
      throw new Error('Could not persist routes.');
    }
  }
}

export const routeManager = new RouteManager();
