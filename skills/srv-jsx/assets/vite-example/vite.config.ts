import fullstack from "@hiogawa/vite-plugin-fullstack";
import srvJsx from "srv-jsx/vite";
import { defineConfig } from "vite-plus";
import devtoolsJson from "vite-plugin-devtools-json";

export default defineConfig({
  plugins: [fullstack(), srvJsx(), devtoolsJson()],
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
