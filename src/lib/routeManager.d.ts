export type ProxyRoutes = Record<string, string>;
export declare class RouteManager {
    private routes;
    constructor();
    loadRoutes(): void;
    getRoutes(): ProxyRoutes;
    getTarget(path: string): string | null;
    addRoute(path: string, target: string): void;
    deleteRoute(path: string): void;
    private saveRoutes;
}
export declare const routeManager: RouteManager;
//# sourceMappingURL=routeManager.d.ts.map