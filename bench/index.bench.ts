import { bench, describe } from "vite-plus/test";
import { Suspense as ReactSuspense, createElement, use } from "react";
import type { ReactNode } from "react";

import {
  Suspense as SrvJsxSuspense,
  jsx,
  jsxs,
  renderToReadableStream as renderSrvJsxToReadableStream,
} from "../src/index.ts";
import type { JSXChild, JSXProps } from "../src/index.ts";

process.env.NODE_ENV = "production";

const { renderToReadableStream: renderReactToReadableStream } = await import("react-dom/server");
const sections = 24;
const itemsPerSection = 16;
const detailsPerItem = 4;
const asyncSections = 8;
const asyncItemsPerSection = 8;
const asyncDetailsPerItem = 2;

const srvJsxTree = createSrvJsxTree();
const reactTree = createReactTree();

describe("SSR renderToReadableStream", () => {
  bench("srv-jsx", async () => {
    await drainStream(await renderSrvJsxToReadableStream(srvJsxTree));
  });

  bench("react-dom/server", async () => {
    await drainStream((await renderReactToReadableStream(reactTree)) as ReadableStream<Uint8Array>);
  });
});

describe("async SSR renderToReadableStream", () => {
  bench("srv-jsx", async () => {
    await drainStream(await renderSrvJsxToReadableStream(createSrvJsxAsyncTree()));
  });

  bench("react-dom/server", async () => {
    await drainStream(
      (await renderReactToReadableStream(createReactAsyncTree())) as ReadableStream<Uint8Array>,
    );
  });
});

function createSrvJsxTree(): JSXChild {
  return element(
    "main",
    { className: "dashboard", "data-renderer": "srv-jsx" },
    element("h1", null, "SSR benchmark"),
    element(
      "section",
      { "aria-label": "Summary" },
      element("p", null, "Static HTML with nested sections, lists, attributes, and text."),
      element(
        "dl",
        null,
        element("dt", null, "Sections"),
        element("dd", null, sections),
        element("dt", null, "Items"),
        element("dd", null, sections * itemsPerSection),
      ),
    ),
    Array.from({ length: sections }, (_, sectionIndex) =>
      element(
        "section",
        {
          "aria-labelledby": `section-${sectionIndex}`,
          className: "panel",
          "data-section": sectionIndex,
        },
        element("h2", { id: `section-${sectionIndex}` }, `Section ${sectionIndex + 1}`),
        element(
          "ul",
          null,
          Array.from({ length: itemsPerSection }, (_, itemIndex) =>
            element(
              "li",
              {
                className: itemIndex % 2 === 0 ? "item even" : "item odd",
                "data-rank": itemIndex + 1,
              },
              element("h3", null, `Item ${sectionIndex + 1}.${itemIndex + 1}`),
              element(
                "p",
                null,
                `Rendered content includes escaped values like <${sectionIndex}:${itemIndex}>.`,
              ),
              element(
                "ol",
                null,
                Array.from({ length: detailsPerItem }, (_, detailIndex) =>
                  element(
                    "li",
                    { "data-detail": detailIndex },
                    `Detail ${detailIndex + 1} for item ${itemIndex + 1}`,
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    ),
  );
}

function createSrvJsxAsyncTree(): JSXChild {
  return element(
    "main",
    { className: "dashboard", "data-renderer": "srv-jsx", "data-mode": "async" },
    element("h1", null, "Async SSR benchmark"),
    Array.from({ length: asyncSections }, (_, sectionIndex) =>
      element(
        "section",
        { className: "panel", "data-section": sectionIndex },
        element("h2", null, `Async section ${sectionIndex + 1}`),
        element(
          "ul",
          null,
          Array.from({ length: asyncItemsPerSection }, (_, itemIndex) =>
            element(
              "li",
              { "data-rank": itemIndex + 1 },
              suspense(
                element("span", { className: "loading" }, "Loading item"),
                Promise.resolve(
                  element(
                    "article",
                    null,
                    element("h3", null, `Async item ${sectionIndex + 1}.${itemIndex + 1}`),
                    element(
                      "p",
                      null,
                      Promise.resolve(
                        `Resolved content includes escaped values like <${sectionIndex}:${itemIndex}>.`,
                      ),
                    ),
                    element(
                      "ol",
                      null,
                      Array.from({ length: asyncDetailsPerItem }, (_, detailIndex) =>
                        element(
                          "li",
                          { "data-detail": detailIndex },
                          Promise.resolve(
                            `Async detail ${detailIndex + 1} for item ${itemIndex + 1}`,
                          ),
                        ),
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    ),
  );
}

function createReactTree(): ReactNode {
  return createElement(
    "main",
    { className: "dashboard", "data-renderer": "react" },
    createElement("h1", null, "SSR benchmark"),
    createElement(
      "section",
      { "aria-label": "Summary" },
      createElement("p", null, "Static HTML with nested sections, lists, attributes, and text."),
      createElement(
        "dl",
        null,
        createElement("dt", null, "Sections"),
        createElement("dd", null, sections),
        createElement("dt", null, "Items"),
        createElement("dd", null, sections * itemsPerSection),
      ),
    ),
    Array.from({ length: sections }, (_, sectionIndex) =>
      createElement(
        "section",
        {
          "aria-labelledby": `section-${sectionIndex}`,
          className: "panel",
          "data-section": sectionIndex,
        },
        createElement("h2", { id: `section-${sectionIndex}` }, `Section ${sectionIndex + 1}`),
        createElement(
          "ul",
          null,
          Array.from({ length: itemsPerSection }, (_, itemIndex) =>
            createElement(
              "li",
              {
                className: itemIndex % 2 === 0 ? "item even" : "item odd",
                "data-rank": itemIndex + 1,
              },
              createElement("h3", null, `Item ${sectionIndex + 1}.${itemIndex + 1}`),
              createElement(
                "p",
                null,
                `Rendered content includes escaped values like <${sectionIndex}:${itemIndex}>.`,
              ),
              createElement(
                "ol",
                null,
                Array.from({ length: detailsPerItem }, (_, detailIndex) =>
                  createElement(
                    "li",
                    { "data-detail": detailIndex },
                    `Detail ${detailIndex + 1} for item ${itemIndex + 1}`,
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    ),
  );
}

function createReactAsyncTree(): ReactNode {
  return createElement(
    "main",
    { className: "dashboard", "data-renderer": "react", "data-mode": "async" },
    createElement("h1", null, "Async SSR benchmark"),
    Array.from({ length: asyncSections }, (_, sectionIndex) =>
      createElement(
        "section",
        { className: "panel", "data-section": sectionIndex },
        createElement("h2", null, `Async section ${sectionIndex + 1}`),
        createElement(
          "ul",
          null,
          Array.from({ length: asyncItemsPerSection }, (_, itemIndex) =>
            createElement(
              "li",
              { "data-rank": itemIndex + 1 },
              createElement(
                ReactSuspense,
                { fallback: createElement("span", { className: "loading" }, "Loading item") },
                createElement(
                  "article",
                  null,
                  createElement("h3", null, `Async item ${sectionIndex + 1}.${itemIndex + 1}`),
                  createElement(ReactAsyncText, {
                    text: Promise.resolve(
                      `Resolved content includes escaped values like <${sectionIndex}:${itemIndex}>.`,
                    ),
                  }),
                  createElement(
                    "ol",
                    null,
                    Array.from({ length: asyncDetailsPerItem }, (_, detailIndex) =>
                      createElement(
                        "li",
                        { "data-detail": detailIndex },
                        createElement(ReactAsyncText, {
                          text: Promise.resolve(
                            `Async detail ${detailIndex + 1} for item ${itemIndex + 1}`,
                          ),
                        }),
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    ),
  );
}

function element(type: string, props: JSXProps | null, ...children: readonly JSXChild[]) {
  const resolvedProps = withChildren(props, children);

  return Array.isArray(resolvedProps.children)
    ? jsxs(type, resolvedProps)
    : jsx(type, resolvedProps);
}

function suspense(fallback: JSXChild, children: JSXChild) {
  return SrvJsxSuspense({ children, fallback });
}

function ReactAsyncText({ text }: { text: Promise<string> }) {
  return use(text);
}

function withChildren<Props extends Record<string, unknown>, Child>(
  props: Props | null,
  children: readonly Child[],
): Props & { children?: Child | readonly Child[] } {
  if (children.length === 0) {
    return { ...(props ?? ({} as Props)) };
  }

  return {
    ...(props ?? ({} as Props)),
    children: children.length === 1 ? children[0] : children,
  };
}

async function drainStream(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader();

  while (true) {
    const result = await reader.read();

    if (result.done) {
      break;
    }
  }
}
