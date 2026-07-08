import { fileURLToPath } from "node:url";

import { cloudflare } from "@cloudflare/vite-plugin";
import fullstack from "@hiogawa/vite-plugin-fullstack";
import devtoolsJson from "vite-plugin-devtools-json";
import { defineConfig, type UserConfig } from "vite-plus";

import srvJsx from "./src/vite.ts";

export default defineConfig(
  ({ mode }) =>
    ({
      plugins:
        mode === "test" || mode === "benchmark"
          ? []
          : [
              fullstack({ serverHandler: false }),
              srvJsx(),
              devtoolsJson(),
              cloudflare({
                viteEnvironment: { name: "ssr" },
              }),
            ],
      environments: {
        client: {
          build: {
            outDir: "dist/client",
            rolldownOptions: {
              input: "./demo/browser.ts",
            },
          },
        },
        ssr: {
          build: {
            emitAssets: true,
            outDir: "dist/ssr",
            rolldownOptions: {
              input: "./demo/index.tsx",
            },
          },
        },
      },
      resolve: {
        alias: [
          {
            find: "srv-jsx/jsx-dev-runtime",
            replacement: fileURLToPath(new URL("./src/jsx-dev-runtime.ts", import.meta.url)),
          },
          {
            find: "srv-jsx/jsx-runtime",
            replacement: fileURLToPath(new URL("./src/jsx-runtime.ts", import.meta.url)),
          },
          {
            find: "srv-jsx/transforms",
            replacement: fileURLToPath(new URL("./src/transforms.ts", import.meta.url)),
          },
          {
            find: "srv-jsx",
            replacement: fileURLToPath(new URL("./src/index.ts", import.meta.url)),
          },
        ],
      },
      staged: {
        "*": "vp check --fix",
      },
      pack: {
        dts: {
          tsgo: true,
        },
        entry: [
          "src/index.ts",
          "src/jsx-runtime.ts",
          "src/jsx-dev-runtime.ts",
          "src/transforms.ts",
          "src/vite.ts",
        ],
        exports: true,
        minify: true,
        sourcemap: true,
      },
      lint: {
        options: {
          typeAware: true,
          typeCheck: true,
        },
      },
      fmt: {},
    }) as UserConfig,
);
