import { renderToReadableStream, Suspense, type JSXChild } from "srv-jsx";

import "./global.css";

import serverAssets from "./server.tsx?assets=ssr";
import browserAssets from "./browser.ts?assets=client";

const assets = serverAssets.merge(browserAssets);

export default {
  fetch(): Promise<Response> {
    return render(
      <Document>
        <main>
          <h1>srv-jsx + Vite</h1>
          <button
            onclick={(event) => {
              "use client";
              event.preventDefault();
              const self = event.currentTarget as HTMLButtonElement;
              const span = self.querySelector("span") as HTMLSpanElement;
              const count = parseInt(span.textContent);
              span.textContent = (count + 1).toString();
            }}
          >
              Count <span>0</span>
          </button>
          <Suspense fallback={<p>Loading...</p>}>
            <Message />
          </Suspense>
        </main>
      </Document>,
    );
  },
};

async function render(node: JSXChild) {
  return new Response(await renderToReadableStream(node), {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
    },
  });
}

function Document({ children }: { children?: JSXChild }) {
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>srv-jsx + Vite</title>
        {assets.css.map((asset) => (
          <link rel="stylesheet" href={asset.href} />
        ))}
        {assets.entry ? <script async type="module" src={assets.entry} /> : null}
        {assets.js.map((asset) => (
          <link rel="modulepreload" href={asset.href} />
        ))}
      </head>
      <body>{children}</body>
    </html>
  );
}

async function Message() {
  await new Promise((resolve) => setTimeout(resolve, 250));
  return <p>Streamed server content is ready.</p>;
}
