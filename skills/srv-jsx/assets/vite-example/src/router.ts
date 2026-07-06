import type { Route } from "remix/fetch-router/routes";
import { createRouter, type Action, type Router } from "remix/router";

import { render } from "./middleware/render.tsx";
import { routes } from "./routes.ts";

const router = createRouter({
  middleware: [render()],
});

declare module "remix/router" {
  interface RouterTypes {
    context: typeof router extends Router<infer C> ? C : never;
  }
}

// Files in `./actions/` map to the route definitions in `./routes.ts`

const controllerModules = Object.assign(
  {},
  import.meta.glob<true, string, () => Promise<{ default: Action<any> }>>("./actions/**/*.ts"),
  import.meta.glob<true, string, () => Promise<{ default: Action<any> }>>("./actions/**/*.tsx"),
);

for (const [filepath, loadMod] of Object.entries(controllerModules)) {
  const parts = filepath
    .replace(/^\.\/actions\//, "")
    .replace(/\.tsx?$/, "")
    .split("/");
  const name = parts.pop();
  if (!name) throw new Error(`Invalid controller path: ${filepath}`);

  let routesToRead = routes;
  for (const part of parts) {
    routesToRead = (routesToRead as any)?.[part];
  }
  const route = (routesToRead as any)?.[name] as Route;
  if (!route) {
    throw new Error(`Route not found: ${[...parts, name].join(".")}`);
  }
  router.route(route.method, route.pattern, async (ctx) => {
    const mod = await loadMod();
    if (typeof mod.default === "function") {
      return mod.default(ctx);
    }
    return mod.default.handler(ctx);
  });
}

export default router;
