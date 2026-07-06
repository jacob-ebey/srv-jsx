import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

import { expect, test } from "vite-plus/test";

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

test("build preserves inline client handler exports when user config disables entry signatures", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "srv-jsx-vite-"));

  try {
    await mkdir(path.join(root, "src"), { recursive: true });
    await symlink(
      path.join(projectRoot, "node_modules"),
      path.join(root, "node_modules"),
      process.platform === "win32" ? "junction" : "dir",
    );

    await writeFile(path.join(root, "package.json"), JSON.stringify({ type: "module" }, null, 2));
    await writeFile(
      path.join(root, "tsconfig.json"),
      JSON.stringify(
        {
          compilerOptions: {
            jsx: "react-jsx",
            jsxImportSource: "srv-jsx",
            module: "preserve",
            moduleResolution: "bundler",
            target: "esnext",
          },
        },
        null,
        2,
      ),
    );
    await writeFile(path.join(root, "src/browser.ts"), 'console.log("browser");\n');
    await writeFile(
      path.join(root, "src/server.tsx"),
      `
import { renderToReadableStream } from "srv-jsx";

export const Page = () =>
  renderToReadableStream(
    <button
      onclick={() => {
        "use client";
        globalThis.document.documentElement.setAttribute("data-theme", "dark");
      }}
    >
      Dark
    </button>,
  );
`,
    );
    await writeFile(
      path.join(root, "vite.config.ts"),
      `
import { defineConfig } from "vite-plus";

import srvJsx from ${JSON.stringify(pathToFileURL(path.join(projectRoot, "src/vite.ts")).href)};

const projectRoot = ${JSON.stringify(projectRoot)};

export default defineConfig({
  plugins: [srvJsx()],
  environments: {
    client: {
      build: {
        outDir: "dist/client",
        rolldownOptions: {
          input: "./src/browser.ts",
          preserveEntrySignatures: false,
        },
      },
    },
    ssr: {
      build: {
        outDir: "dist/ssr",
        rolldownOptions: {
          input: "./src/server.tsx",
        },
      },
    },
  },
  resolve: {
    alias: [
      {
        find: "srv-jsx/jsx-dev-runtime",
        replacement: projectRoot + "/src/jsx-dev-runtime.ts",
      },
      {
        find: "srv-jsx/jsx-runtime",
        replacement: projectRoot + "/src/jsx-runtime.ts",
      },
      {
        find: "srv-jsx",
        replacement: projectRoot + "/src/index.ts",
      },
    ],
  },
});
`,
    );

    const { stderr, stdout } = await execFileAsync(
      path.join(projectRoot, "node_modules/.bin/vp"),
      ["build"],
      {
        cwd: root,
      },
    );

    const assets = await readdir(path.join(root, "dist/client/assets"));
    const jsOutputs = await Promise.all(
      assets
        .filter((asset) => asset.endsWith(".js"))
        .map((asset) => readFile(path.join(root, "dist/client/assets", asset), "utf8")),
    );

    expect(`${stdout}${stderr}`).toContain("built");
    expect(jsOutputs.join("\n")).toContain("__srv_jsx_client_0");
    expect(jsOutputs.join("\n")).toContain("data-theme");
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
