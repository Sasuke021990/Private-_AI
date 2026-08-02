import { prisma } from './db';

export interface RouteConfig {
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
        newRoutes[r.path] = { target: r.target, type: r.type as 'app' | 'api', userId: r.userId };
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

  public async addRoute(path: string, target: string, type: 'app' | 'api' = 'api', userId: string): Promise<void> {
    await prisma.route.upsert({
      where: { path },
      update: { target, type, userId },
      create: { path, target, type, userId }
    });
    await this.loadRoutes();
  }

  public async deleteRoute(path: string): Promise<void> {
    await prisma.route.delete({ where: { path } }).catch(() => {});
    await this.loadRoutes();
  }
}

export const routeManager = new RouteManager();
