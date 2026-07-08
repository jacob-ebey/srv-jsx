import { isbot } from "isbot";
import { renderWith } from "remix/middleware/render";
import { createHtmlResponse } from "remix/response/html";
import { renderToReadableStream, type JSXChild } from "srv-jsx";

import browserAssets from "../browser.ts?assets=client";

const bootstrapModules = browserAssets.entry ? [browserAssets.entry] : undefined;

export function render() {
  return renderWith(({ request }) => async (root: JSXChild, init?: ResponseInit) => {
    const body = await renderToReadableStream(root, {
      bootstrapModules,
      onError: console.error.bind(console),
      prerender: isbot(request.headers.get("User-Agent")),
      signal: request.signal,
    });

    const headers = new Headers(init?.headers);

    return createHtmlResponse(body, {
      ...init,
      headers,
    });
  });
}
