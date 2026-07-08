import { ErrorBoundary, type JSXChild } from "srv-jsx";

import "./document.css";

import serverAssets from "./document.tsx?assets=ssr";
import browserAssets from "../browser.ts?assets=client";

const assets = serverAssets.merge(browserAssets);

export function Document({ children }: { children?: JSXChild }) {
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        {assets.css.map((asset) => (
          <link rel="stylesheet" href={asset.href} />
        ))}
        {assets.js.map((asset) => (
          <link rel="modulepreload" href={asset.href} />
        ))}
      </head>
      <body>
        <ErrorBoundary
          fallback={
            <main>
              <h1>Oops, something went wrong</h1>
            </main>
          }
        >
          {children}
        </ErrorBoundary>
      </body>
    </html>
  );
}
