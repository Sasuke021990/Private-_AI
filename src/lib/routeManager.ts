import { prisma } from '../db';

export interface RouteConfig {
  id: string;
  target: string;
  type: 'app' | 'api';
  userId: string;
}

export type ProxyRoutes = Record<string, RouteConfig>;

export class RouteManager {
  private routes: ProxyRoutes = {};

  constructor() {
    // initial load
  }

  public async loadRoutes(): Promise<void> {
    try {
      const dbRoutes = await prisma.route.findMany();
      const newRoutes: ProxyRoutes = {};
      for (const r of dbRoutes) {
        newRoutes[r.path] = { id: r.id, target: r.target, type: r.type as 'app' | 'api', userId: r.userId };
      }
      this.routes = newRoutes;
    } catch (error) {
      console.error('Failed to load routes from DB:', error);
    }
  }

  public getRoutes(): ProxyRoutes {
    return this.routes;
  }

  public getTarget(path: string): string | null {
    const matchingPaths = Object.keys(this.routes).filter(prefix => path.startsWith(prefix));
    if (matchingPaths.length === 0) return null;
    matchingPaths.sort((a, b) => b.length - a.length);
    return this.routes[matchingPaths[0]]?.target || null;
  }

  public getRouteConfig(path: string): RouteConfig | null {
    return this.routes[path] || null;
  }

  public matchRoute(path: string): { prefix: string; config: RouteConfig } | null {
    const matchingPaths = Object.keys(this.routes).filter(prefix => path.startsWith(prefix));
    if (matchingPaths.length === 0) return null;
    matchingPaths.sort((a, b) => b.length - a.length);
    const prefix = matchingPaths[0];
    return { prefix, config: this.routes[prefix] };
  }

  public async addRoute(path: string, target: string, type: 'app' | 'api' = 'api', userId: string): Promise<{ id: string }> {
    const route = await prisma.route.upsert({
      where: { path },
      update: { target, type, userId },
      create: { path, target, type, userId }
    });
    await this.loadRoutes();
    return { id: route.id };
  }

  public async deleteRoute(path: string): Promise<void> {
    await prisma.route.delete({ where: { path } }).catch(() => {});
    await this.loadRoutes();
  }
}

export const routeManager = new RouteManager();
