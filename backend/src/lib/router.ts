import type { ApiEvent, ApiResult } from './http';

export interface RouteContext {
  event: ApiEvent;
  params: Record<string, string>;
}

export interface Route {
  method: string;
  path: string; // template, e.g. /courses/{id}
  /** Requires a signed-in user. API Gateway's authorizer is the first gate; this is the second. */
  auth: boolean;
  handler: (ctx: RouteContext) => Promise<ApiResult>;
}

interface CompiledRoute extends Route {
  regex: RegExp;
  keys: string[];
}

/**
 * Matches on method + raw path rather than event.routeKey, so the same code works behind
 * explicit API Gateway routes, a {proxy+} route, and the local dev server.
 */
export class Router {
  private routes: CompiledRoute[] = [];

  add(route: Route): this {
    const keys: string[] = [];
    const pattern = route.path.replace(/\{(\w+)\}/g, (_m, key: string) => {
      keys.push(key);
      return '([^/]+)';
    });
    this.routes.push({ ...route, keys, regex: new RegExp(`^${pattern}/?$`) });
    return this;
  }

  /** Returns the route and decoded params, 'method' when only the method is wrong, or null. */
  match(method: string, rawPath: string): { route: CompiledRoute; params: Record<string, string> } | 'method' | null {
    const path = stripStage(rawPath);
    let pathMatched = false;
    for (const r of this.routes) {
      const m = r.regex.exec(path);
      if (!m) continue;
      pathMatched = true;
      if (r.method !== method) continue;
      const params: Record<string, string> = {};
      r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
      return { route: r, params };
    }
    return pathMatched ? 'method' : null;
  }

  list(): Route[] {
    return this.routes;
  }
}

// A named stage such as /prod is part of rawPath; API_BASE_PATH lets the router ignore it.
function stripStage(rawPath: string): string {
  const base = process.env.API_BASE_PATH;
  if (base && rawPath.startsWith(base)) return rawPath.slice(base.length) || '/';
  return rawPath;
}
