import { isbot } from "isbot";
import { renderWith } from "remix/middleware/render";
import { createHtmlResponse } from "remix/response/html";
import { renderToReadableStream, type JSXChild } from "srv-jsx";

export function render() {
  return renderWith(({ request }) => async (root: JSXChild, init?: ResponseInit) => {
    const nonce = btoa(crypto.randomUUID());
    const body = await renderToReadableStream(root, {
      nonce,
      prerender: isbot(request.headers.get("User-Agent")),
      signal: request.signal,
    });

    const headers = new Headers(init?.headers);

    if (import.meta.env.DEV) {
      // enable unsafe-eval in dev mode
      headers.append(
        "Content-Security-Policy",
        `script-src 'self' 'nonce-${nonce}' 'unsafe-eval'; worker-src 'self' blob:`,
      );
    } else {
      headers.append("Content-Security-Policy", `script-src 'self' 'nonce-${nonce}'`);
    }

    return createHtmlResponse(body, {
      ...init,
      headers,
    });
  });
}
