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
