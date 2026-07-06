---
name: srv-jsx
description: 'Portable guidance for building and modifying projects that use srv-jsx: applications, components, JSX files, Vite integration, streaming HTML, Suspense/ErrorBoundary usage, client references, and "use client" code. Use when working in any srv-jsx project or authoring JSX for srv-jsx; steer away from React, Preact, Solid, Qwik, and other JSX framework patterns.'
---

# srv-jsx

srv-jsx is a server-only JSX runtime for streaming HTML. Treat JSX as declarative
server-rendered HTML, not as a client component framework.

## Ground Rules

- Inspect the host project's README, package scripts, JSX/TypeScript config, Vite config, examples, and tests before editing.
- Follow the host project's existing srv-jsx patterns and validation commands.
- Do not introduce React, Preact, Solid, Qwik, or framework-specific abstractions.
- Do not use hooks, providers, context, stateful client components, hydration, virtual DOM, or effects.
- Do not treat `jsx: "react-jsx"` as a React dependency. In srv-jsx it is the TypeScript automatic JSX transform mode paired with `jsxImportSource: "srv-jsx"`.
- Write components as plain server functions that return JSX children, promises, or native child values accepted by the runtime.
- Prefer platform HTML and browser primitives: forms, buttons, dialogs, popovers, CSS, custom events, and DOM APIs.

## Vite Setup

- Add `srv-jsx` and `vite` with the host project's package manager. Do not add React or a JSX framework unless the project already uses one for unrelated code.
- For a copyable starter project, inspect `assets/vite-example/`. It demonstrates the srv-jsx Vite plugin, `fullstack()`, separate `client`/`ssr` environments, and `?assets=client`.
- Configure TypeScript/JSX to use the srv-jsx runtime:

```json
{
  "compilerOptions": {
    "jsx": "react-jsx",
    "jsxImportSource": "srv-jsx"
  }
}
```

- Add the srv-jsx Vite plugin:

```ts
import { defineConfig } from "vite";
import srvJsx from "srv-jsx/vite";

export default defineConfig({
  plugins: [srvJsx()],
  environments: {
    client: {},
    ssr: {},
  },
});
```

- For full-stack Vite apps, use `@hiogawa/vite-plugin-fullstack` alongside srv-jsx. Keep `fullstack()` before `srvJsx()` so the server/client environments exist before srv-jsx wires client references:

```ts
import fullstack from "@hiogawa/vite-plugin-fullstack";
import { defineConfig } from "vite";
import srvJsx from "srv-jsx/vite";

export default defineConfig({
  plugins: [fullstack(), srvJsx()],
  environments: {
    client: {
      build: {
        outDir: "dist/client",
        rolldownOptions: {
          input: "./src/browser.ts",
        },
      },
    },
    ssr: {
      build: {
        emitAssets: true,
        outDir: "dist/ssr",
        rolldownOptions: {
          input: "./src/server.tsx",
        },
      },
    },
  },
});
```

- Link the browser entry from the server-rendered document with the fullstack plugin's assets query. The query suffix must match the client environment name, so `?assets=client` targets `environments.client`:

```tsx
import browserAssets from "./browser.ts?assets=client";

function Document({ children }: { children?: JSXChild }) {
  return (
    <html>
      <head>
        {browserAssets.css.map((asset: any) => (
          <link rel="stylesheet" href={asset.href} />
        ))}
        <script async type="module" src={browserAssets.entry} />
        {browserAssets.js.map((asset: any) => (
          <link rel="modulepreload" href={asset.href} />
        ))}
      </head>
      <body>{children}</body>
    </html>
  );
}
```

- The plugin defaults to a `client` environment and an `ssr` server environment. If the project uses different Vite environment names, pass them explicitly:

```ts
srvJsx({
  clientEnvironment: "browser",
  serverEnvironments: ["server"],
});
```

- Keep deployment-adapter setup separate: Cloudflare, Node, full-stack routing, or other server plugins should provide the request handler/build target around srv-jsx.
- Add explicit client inputs only for browser bootstrap code such as polyfills or global event setup. Files containing `"use client"` directives are discovered and added to the client build by the srv-jsx plugin.

## JSX Model

- Use HTML-shaped attributes. `className` renders as `class`, and `htmlFor` renders as `for`, but plain `class` and native attributes are natural here.
- Use string CSS: `style="color: red"` or template-string CSS in `innerHTML`. Do not use React object styles.
- Use `innerHTML="<p>safe html</p>"` only when the component owns already-sanitized HTML. Do not use React's `dangerouslySetInnerHTML` object shape.
- Use `<Suspense fallback={...}>` for async server rendering and `<ErrorBoundary fallback={...}>` for streamed fallback replacement.
- Keep event attributes as client references produced by the srv-jsx transform. Ordinary server function callbacks are rejected at render time.

## `"use client"`

- Treat `"use client"` as a transform directive for browser JavaScript, not as a client component boundary.
- After `"use client"`, you are outside the srv-jsx component model. Write raw browser JS: handle the event, call DOM APIs, query elements, dispatch events, mutate attributes/classes, or call browser-only libraries.
- Do not return JSX from `"use client"` code expecting srv-jsx to reconcile or re-render it. If the UI must change on the client, update the DOM or use native browser behavior.
- Use inline directives for small event handlers:

```tsx
<button
  onclick={(event) => {
    "use client";
    event.currentTarget?.toggleAttribute("data-active");
  }}
>
  Toggle
</button>
```

- Be deliberate with captured server values in inline client handlers; only capture values that make sense to serialize/bind into a browser callback.
- Do not mix module-level and inline `"use client"` directives in the same file.
- Do not nest inline `"use client"` functions.
- Avoid `export *` in module-level `"use client"` files; export named client entry points directly.

## Validation

Run the host project's normal formatting, linting, type checking, build, and test commands after changes. Prefer commands documented in its README, package scripts, task runner, or agent instructions.
