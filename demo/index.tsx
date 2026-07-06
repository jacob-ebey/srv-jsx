import { ErrorBoundary, renderToReadableStream, Suspense, type JSXChild } from "srv-jsx";

import browserAssets from "./browser.ts?assets=client";

const css = String.raw;

// function onClick(url: string, event: MouseEvent) {
//   "use client";
//   console.log("Button Clicked", url, event);
// }

export default {
  fetch(request: Request): Promise<Response> {
    return render(
      <Document>
        <style
          innerHTML={css`
            @media (min-width: 768px) {
              .grid {
                display: grid;
                grid-template-columns: repeat(2, 1fr);
              }
            }
          `}
        />
        <div class="grid">
          <div class="window">
            <div class="title-bar">
              <h1 class="title">Async Loading</h1>
            </div>
            <div class="separator"></div>
            <div class="modeless-dialog">
              <button
                onclick={(event) => {
                  "use client";
                  console.log("Button Clicked", request.url, event);
                }}
              >
                Test
              </button>
              <p>
                We can now render placeholders and send the replacement content later in the
                document with the new <code>&lt;?start name&gt;</code>, and{" "}
                <code>&lt;?end name&gt;</code> processing instructions along with the{" "}
                <code>&lt;template for&gt;</code> attribute.
              </p>
              <Suspense fallback={<p>Loading...</p>}>
                <Async />
              </Suspense>
              <p>
                This is accomplished in srv-jsx with the <code>&lt;Suspense&gt;</code> component.
              </p>
              <p>
                We can use this same mechanism with different flushing semantics, srv-jsx also
                introduces an <code>&lt;ErrorBoundary&gt;</code> component to catch child component
                errors and "unwind" the UI to the nearest error boundary.
              </p>
              <ErrorBoundary fallback={<p>Oops...</p>}>
                <Suspense fallback={<p>Loading...</p>}>
                  <AsyncThrow />
                </Suspense>
              </ErrorBoundary>
            </div>
          </div>

          <div class="window">
            <div class="title-bar">
              <h1 class="title">Popovers</h1>
            </div>
            <div class="separator"></div>

            <div class="modeless-dialog">
              <p>Native popover is baseline.</p>

              <button class="btn" popovertarget="example-menu" style="anchor-name: --file-menu;">
                Open Menu
              </button>
              <ul
                role="menu"
                id="example-menu"
                popover
                style="position-anchor: --file-menu; position-area: bottom center;"
              >
                <li role="menu-item">
                  <button>Action 1</button>
                </li>
                <li role="menu-item">
                  <button>Action 2</button>
                </li>
                <li role="menu-item" class="divider">
                  <button>Action 3</button>
                </li>
                <li role="menu-item">
                  <button>Action 4</button>
                </li>
              </ul>

              <p>You can build all types of experiences with it.</p>
              <ul>
                <li>Dropdown Menus & Navigations</li>
                <li>Custom Tooltips & Information Cards</li>
                <li>Action & Context Menus</li>
                <li>etc.</li>
              </ul>
            </div>
          </div>

          <div class="window">
            <div class="title-bar">
              <h1 class="title">Dialogs</h1>
            </div>
            <div class="separator"></div>

            <div class="modeless-dialog">
              <p>
                Native <code>&lt;dialog&gt;</code> is baseline.
              </p>
              <button class="btn" command="show-modal" commandfor="example-dialog">
                Open Dialog
              </button>
              <dialog id="example-dialog" class="modal-dialog outer-border" style="width: 30rem;">
                <div class="inner-border center">
                  <div class="modal-contents">
                    <h1 class="modal-text">Modal Dialog</h1>
                    <p>This dialog was opened using an invoker command.</p>

                    <section
                      class="field-row"
                      style="justify-content: flex-end"
                      focusgroup="menubar"
                    >
                      <button class="btn" commandfor="example-dialog" command="close">
                        Cancel
                      </button>
                      <button
                        class="btn"
                        commandfor="example-dialog"
                        command="close"
                        style="width:95px;"
                      >
                        OK
                      </button>
                    </section>
                  </div>
                </div>
              </dialog>

              <p>
                Since <code>&lt;dialog&gt;</code> is just a normal element you can style, it opens
                up a whole host of experiences without JavaScript.
              </p>
              <ul>
                <li>Modal dialogs</li>
                <li>Modeless dialogs</li>
                <li>Responsive sidebars</li>
                <li>Drawers</li>
                <li>etc.</li>
              </ul>
            </div>
          </div>

          <div class="window">
            <div class="title-bar">
              <h1 class="title">Polyfills</h1>
            </div>
            <div class="separator"></div>

            <div class="modeless-dialog">
              <p>
                The new processing instructions and template for behavior can be polyfilled with:
              </p>
              <pre
                class="window"
                style="overflow-x: auto; padding: 8px; margin: 0; box-sizing: border-box;"
              >
                <code>
                  &lt;script async
                  src="https://unpkg.com/template-for-polyfill@0.1.0/dist/template-for-polyfill.js"&gt;&lt;/script&gt;
                </code>
              </pre>
              <p>
                And invoker commands can be polyfilled with:
                <pre
                  class="window"
                  style="overflow-x: auto; padding: 8px; margin: 0; box-sizing: border-box;"
                >
                  <code>
                    &lt;script async
                    src="https://unpkg.com/invokers-polyfill@1.0.3/invoker.min.js"&gt;&lt;/script&gt;
                  </code>
                </pre>
              </p>
            </div>
          </div>
        </div>
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
        <title>Demo</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="stylesheet" href="https://sakofchit.github.io/system.css/system.css" />
        {browserAssets.css.map((asset) => (
          <link rel="stylesheet" href={asset.href} />
        ))}
        <script async type="module" src={browserAssets.entry} />
        {browserAssets.js.map((asset) => (
          <link rel="modulepreload" href={asset.href} />
        ))}
      </head>
      <body>{children}</body>
    </html>
  );
}

async function Async() {
  await new Promise((resolve) => setTimeout(resolve, 1000));
  return <p>Async content :D</p>;
}

async function AsyncThrow(): Promise<JSXChild> {
  await new Promise((resolve) => setTimeout(resolve, 2000));
  throw new Error("Oops");
}
