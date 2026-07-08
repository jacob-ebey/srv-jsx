import { expect, test } from "vite-plus/test";
import {
  ErrorBoundary,
  Suspense,
  defineClientReference,
  renderToReadableStream,
} from "../src/index.ts";
import type { ClientReferenceValue, JSXChild, RenderOptions } from "../src/index.ts";

test("renders escaped elements and raw innerHTML", async () => {
  const html = await renderToText(
    <div className="message" data-value={'a "quoted" <value>'} style="color: red">
      <p>{"Hello, <World>!"}</p>
      <section innerHTML="<strong>Raw HTML</strong>" />
    </div>,
  );

  expect(html).toBe(
    '<div class="message" data-value="a &quot;quoted&quot; &lt;value&gt;" style="color: red"><p>Hello, &lt;World&gt;!</p><section><strong>Raw HTML</strong></section></div>',
  );
});

test("emits doctype before html elements", async () => {
  await expect(
    renderToText(
      <html lang="en">
        <body>Hello</body>
      </html>,
    ),
  ).resolves.toBe('<!DOCTYPE html><html lang="en"><body>Hello</body></html>');
});

test("hoists detached head elements before the head marker", async () => {
  const html = await renderToText(
    <>
      <title>Page</title>
      <html lang="en">
        <head>
          <meta charset="utf-8" />
        </head>
        <body>Hello</body>
      </html>
    </>,
  );

  expect(html).toBe(
    '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Page</title><?marker name="srv-jsx-head"></head><body>Hello</body></html>',
  );
});

test("emits detached head elements in templates after the head is flushed", async () => {
  const html = await renderToText(
    <html lang="en">
      <head>
        <meta charset="utf-8" />
      </head>
      <body>
        <title>Page</title>
        <p>Hello</p>
      </body>
    </html>,
  );

  expect(html).toBe(
    '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><?marker name="srv-jsx-head"></head><body><template for="srv-jsx-head"><title>Page</title><?marker name="srv-jsx-head"></template><p>Hello</p></body></html>',
  );
});

test("renders SVG elements without document head hoisting", async () => {
  const html = await renderToText(
    <html>
      <head />
      <body>
        <svg viewBox="0 0 10 10" focusable={false}>
          <title>Icon</title>
          <style>{".mark{stroke:red}"}</style>
          <circle className="mark" strokeWidth={2} fillOpacity="0.5" />
        </svg>
      </body>
    </html>,
  );

  expect(html).toBe(
    '<!DOCTYPE html><html><head><?marker name="srv-jsx-head"></head><body><svg viewBox="0 0 10 10" focusable="false"><title>Icon</title><style>.mark{stroke:red}</style><circle class="mark" stroke-width="2" fill-opacity="0.5"></circle></svg></body></html>',
  );
});

test("renders foreignObject children as HTML without document head hoisting", async () => {
  const html = await renderToText(
    <svg>
      <foreignObject>
        <div>
          <title>Embedded</title>
          <br />
        </div>
      </foreignObject>
    </svg>,
  );

  expect(html).toBe(
    "<svg><foreignObject><div><title>Embedded</title><br></div></foreignObject></svg>",
  );
});

test("renders Suspense templates in SVG context", async () => {
  const html = await renderToText(
    <svg>
      <Suspense fallback={<circle strokeWidth={1} />}>
        {Promise.resolve(<title>Ready</title>)}
      </Suspense>
    </svg>,
  );

  expect(html).toContain('<circle stroke-width="1"></circle>');
  expect(html).toContain('"><title>Ready</title></template>');
  expect(html).not.toContain("srv-jsx-head");
});

test("renders ErrorBoundary fallback templates in SVG context", async () => {
  const html = await renderToText(
    <svg>
      <ErrorBoundary fallback={<title>Fallback</title>}>
        <Throws />
      </ErrorBoundary>
    </svg>,
  );

  expect(html).toContain('"><title>Fallback</title></template>');
  expect(html).not.toContain("srv-jsx-head");
});

test("rejects callback and object attributes", async () => {
  await expect(
    renderToText(<button onclick={(() => "clicked") as unknown as string}>Click</button>),
  ).rejects.toThrow("event callbacks must be transformed to client references");

  await expect(
    renderToText(<div style={{ color: "red" } as unknown as string}>Styled</div>),
  ).rejects.toThrow('Attribute "style" must be a string');
});

test("renders client reference event scripts after elements", async () => {
  const html = await renderToText(
    <button onclick={clientReference("handleClick", "/assets/button.js")}>Click</button>,
  );

  expect(html).toBe(
    `<button>Click</button><script>(() => {let e = document.currentScript.previousElementSibling;((c)=>import("/assets/button.js").then(m=>c(m["handleClick"].bind(null,...[]))))((r) => e.addEventListener("click", r))})();document.currentScript.remove();</script>`,
  );
});

test("renders client reference event scripts with bind captures", async () => {
  const html = await renderToText(
    <button
      onclick={clientReference("handleClick", "/assets/button.js", ["/current/path", 123, true])}
    >
      Click
    </button>,
  );

  expect(html).toBe(
    `<button>Click</button><script>(() => {let e = document.currentScript.previousElementSibling;((c)=>import("/assets/button.js").then(m=>c(m["handleClick"].bind(null,...["/current/path",123,true]))))((r) => e.addEventListener("click", r))})();document.currentScript.remove();</script>`,
  );
});

test("renders client reference event scripts with chained binds", async () => {
  const reference = clientReference("handleClick", "/assets/button.js")
    .bind(null, "first")
    .bind(null, "second");
  const html = await renderToText(<button onclick={reference}>Click</button>);

  expect(html).toBe(
    `<button>Click</button><script>(() => {let e = document.currentScript.previousElementSibling;((c)=>import("/assets/button.js").then(m=>c(m["handleClick"].bind(null,...["first","second"]))))((r) => e.addEventListener("click", r))})();document.currentScript.remove();</script>`,
  );
});

test("renders client reference ref scripts after elements", async () => {
  const html = await renderToText(
    <section ref={clientReference("mount", "/assets/section.js")}>Content</section>,
  );

  expect(html).toBe(
    `<section>Content</section><script>(() => {let e = document.currentScript.previousElementSibling;((c)=>import("/assets/section.js").then(m=>c(m["mount"].bind(null,...[]))))((r) => r(e))})();document.currentScript.remove();</script>`,
  );
});

test("renders client reference ref scripts with bind captures", async () => {
  const html = await renderToText(
    <section ref={clientReference("mount", "/assets/section.js", ["first", 2])}>Content</section>,
  );

  expect(html).toBe(
    `<section>Content</section><script>(() => {let e = document.currentScript.previousElementSibling;((c)=>import("/assets/section.js").then(m=>c(m["mount"].bind(null,...["first",2]))))((r) => r(e))})();document.currentScript.remove();</script>`,
  );
});

test("types ref callbacks by intrinsic element", () => {
  const canvas = (
    <canvas
      ref={(ref) => {
        "use client";
        ref.getContext("2d");
      }}
    />
  );
  const customElement = (
    <custom-element
      ref={(ref) => {
        "use client";
        ref.getAttribute("data-id");
      }}
    />
  );

  expect([canvas, customElement]).toBeTruthy();
});

test("supports custom client reference loading", async () => {
  const html = await renderToText(
    <input onchange={clientReference("handleChange", "/assets/input.js")} />,
    {
      encodeLoadReference({ name }) {
        return `(c)=>c(() => attach(${JSON.stringify(name)}, "</script>"))`;
      },
    },
  );

  expect(html).toBe(
    '<input><script>(() => {let e = document.currentScript.previousElementSibling;((c)=>c(() => attach("handleChange", "<\\/script>")))((r) => e.addEventListener("change", r))})();document.currentScript.remove();</script>',
  );
});

test("adds nonces to generated client reference event scripts", async () => {
  const html = await renderToText(
    <input onchange={clientReference("handleChange", "/assets/input.js")} />,
    {
      encodeLoadReference({ name }) {
        return `(c)=>c(() => attach(${JSON.stringify(name)}, "</script>"))`;
      },
      nonce: 'nonce"<value>',
    },
  );

  expect(html).toBe(
    '<input><script nonce="nonce&quot;&lt;value&gt;">(() => {let e = document.currentScript.previousElementSibling;((c)=>c(() => attach("handleChange", "<\\/script>")))((r) => e.addEventListener("change", r))})();document.currentScript.remove();</script>',
  );
});

test("nonce on script, link, and style elements is a plain pass-through attribute", async () => {
  const html = await renderToText(
    <>
      <script nonce="explicit" src="/assets/app.js" />
      <link nonce="explicit" rel="modulepreload" href="/assets/app.js" />
      <style nonce="explicit">{".hidden{display:none}"}</style>
    </>,
    { nonce: "configured" },
  );

  expect(html).toBe(
    '<script nonce="explicit" src="/assets/app.js"></script><link nonce="explicit" rel="modulepreload" href="/assets/app.js"><style nonce="explicit">.hidden{display:none}</style>',
  );
});

test("does not add a nonce attribute to user-authored elements automatically", async () => {
  const html = await renderToText(<script src="/assets/app.js" />, { nonce: "configured" });

  expect(html).toBe('<script src="/assets/app.js"></script>');
});

test("adds bootstrapScripts and bootstrapModules after the rendered tree with the configured nonce", async () => {
  const html = await renderToText(<div>Hello</div>, {
    bootstrapModules: ["/assets/module.js"],
    bootstrapScripts: ["/assets/app.js"],
    nonce: 'nonce"<value>',
  });

  expect(html).toBe(
    '<div>Hello</div><script src="/assets/app.js" nonce="nonce&quot;&lt;value&gt;" async></script><script type="module" src="/assets/module.js" nonce="nonce&quot;&lt;value&gt;" async></script>',
  );
});

test("bootstrapScripts and bootstrapModules omit the nonce attribute when none is configured", async () => {
  const html = await renderToText(<div>Hello</div>, {
    bootstrapModules: ["/assets/module.js"],
    bootstrapScripts: ["/assets/app.js"],
  });

  expect(html).toBe(
    '<div>Hello</div><script src="/assets/app.js" async></script><script type="module" src="/assets/module.js" async></script>',
  );
});

test("rejects client references on non-event attributes", async () => {
  await expect(
    renderToText(
      <div data-action={clientReference("action", "/assets/action.js") as unknown as string} />,
    ),
  ).rejects.toThrow("Client references can only be passed to event or ref attributes");
});

test("rejects innerHTML mixed with children", async () => {
  await expect(renderToText(<div innerHTML="<p>Raw</p>">Text</div>)).rejects.toThrow(
    "cannot use both innerHTML and children",
  );
});

test("streams Suspense placeholders and templates", async () => {
  const deferred = createDeferred<JSXChild>();
  const stream = await renderToReadableStream(
    <>
      <div>
        <Suspense fallback={<p>Loading...</p>}>{deferred.promise}</Suspense>
      </div>
      <p>More content that isn't delayed</p>
    </>,
  );
  const reader = stream.getReader();

  await expect(readChunk(reader)).resolves.toBe(suspenseShell);

  deferred.resolve(<p>Hello, World!</p>);

  await expect(readToEnd(reader)).resolves.toBe(
    '<template for="srv-jsx-4kgorb"><p>Hello, World!</p></template>',
  );
});

test("flushes bootstrapScripts and bootstrapModules as part of the shell, before streamed Suspense content", async () => {
  const deferred = createDeferred<JSXChild>();
  const stream = await renderToReadableStream(
    <>
      <div>
        <Suspense fallback={<p>Loading...</p>}>{deferred.promise}</Suspense>
      </div>
      <p>More content that isn't delayed</p>
    </>,
    { bootstrapModules: ["/assets/module.js"], bootstrapScripts: ["/assets/app.js"] },
  );
  const reader = stream.getReader();

  await expect(readChunk(reader)).resolves.toBe(
    `${suspenseShell}<script src="/assets/app.js" async></script><script type="module" src="/assets/module.js" async></script>`,
  );

  deferred.resolve(<p>Hello, World!</p>);

  await expect(readToEnd(reader)).resolves.toBe(
    '<template for="srv-jsx-4kgorb"><p>Hello, World!</p></template>',
  );
});

test("waits for the shell before resolving the stream", async () => {
  const deferred = createDeferred<JSXChild>();
  const streamPromise = renderToReadableStream(<div>{deferred.promise}</div>);
  let resolved = false;

  void streamPromise.then(() => {
    resolved = true;
  });
  await settleMicrotasks();

  expect(resolved).toBe(false);

  deferred.resolve(<p>ready</p>);

  const stream = await streamPromise;

  expect(resolved).toBe(true);
  await expect(readToEnd(stream.getReader())).resolves.toBe("<div><p>ready</p></div>");
});

test("waits for the entire shell before resolving the stream", async () => {
  const deferred = createDeferred<JSXChild>();
  let renderedAfterSuspense = false;
  const stream = await renderToReadableStream(
    <>
      <Suspense fallback={<p>loading</p>}>{deferred.promise}</Suspense>
      <AfterSuspense />
    </>,
  );
  const shell = '<?start name="srv-jsx-vxhwgy"><p>loading</p><?end><p>after</p>';
  const reader = stream.getReader();

  expect(renderedAfterSuspense).toBe(true);
  await expect(readChunk(reader)).resolves.toBe(shell);

  deferred.resolve(<p>inside</p>);
  await expect(readToEnd(reader)).resolves.toBe(
    '<template for="srv-jsx-vxhwgy"><p>inside</p></template>',
  );

  function AfterSuspense(): JSXChild {
    renderedAfterSuspense = true;
    return <p>after</p>;
  }
});

test("waits for async work before the first Suspense boundary", async () => {
  const before = createDeferred<JSXChild>();
  const inside = createDeferred<JSXChild>();
  const streamPromise = renderToReadableStream(
    <>
      {before.promise}
      <Suspense fallback={<p>loading</p>}>{inside.promise}</Suspense>
    </>,
  );
  let resolved = false;

  void streamPromise.then(() => {
    resolved = true;
  });
  await settleMicrotasks();

  expect(resolved).toBe(false);

  before.resolve(<p>before</p>);

  const stream = await streamPromise;
  const shell = '<p>before</p><?start name="srv-jsx-zubyhh"><p>loading</p><?end>';
  const reader = stream.getReader();

  expect(resolved).toBe(true);
  await expect(readUntilLength(reader, shell.length)).resolves.toBe(shell);

  inside.resolve(<p>inside</p>);
  await expect(readToEnd(reader)).resolves.toBe(
    '<template for="srv-jsx-zubyhh"><p>inside</p></template>',
  );
});

test("waits for async work after the first Suspense boundary before resolving the shell", async () => {
  const inside = createDeferred<JSXChild>();
  const after = createDeferred<JSXChild>();
  const streamPromise = renderToReadableStream(
    <>
      <Suspense fallback={<p>loading</p>}>{inside.promise}</Suspense>
      {after.promise}
    </>,
  );
  let resolved = false;

  void streamPromise.then(() => {
    resolved = true;
  });
  await settleMicrotasks();

  expect(resolved).toBe(false);

  after.resolve(<p>after</p>);

  const stream = await streamPromise;
  const reader = stream.getReader();
  const shell = '<?start name="srv-jsx-vxhwgy"><p>loading</p><?end><p>after</p>';

  expect(resolved).toBe(true);
  await expect(readChunk(reader)).resolves.toBe(shell);

  inside.resolve(<p>inside</p>);

  await expect(readToEnd(reader)).resolves.toBe(
    '<template for="srv-jsx-vxhwgy"><p>inside</p></template>',
  );
});

test("prerender renders Suspense children inline", async () => {
  const deferred = createDeferred<JSXChild>();
  const streamPromise = renderToReadableStream(
    <Suspense fallback={<p>loading</p>}>{deferred.promise}</Suspense>,
    { prerender: true },
  );
  let resolved = false;

  void streamPromise.then(() => {
    resolved = true;
  });
  await settleMicrotasks();

  expect(resolved).toBe(false);

  deferred.resolve(<p>ready</p>);
  const stream = await streamPromise;

  expect(resolved).toBe(true);
  await expect(readToEnd(stream.getReader())).resolves.toBe("<p>ready</p>");
});

test("emits detached head elements from Suspense templates before resolved content", async () => {
  const deferred = createDeferred<JSXChild>();
  const stream = await renderToReadableStream(
    <html lang="en">
      <head>
        <meta charset="utf-8" />
      </head>
      <body>
        <Suspense fallback={<p>Fallback</p>}>{deferred.promise}</Suspense>
      </body>
    </html>,
  );
  const reader = stream.getReader();
  const shell =
    '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><?marker name="srv-jsx-head"></head><body><?start name="srv-jsx-1da935"><p>Fallback</p><?end></body></html>';

  await expect(readUntilLength(reader, shell.length)).resolves.toBe(shell);

  deferred.resolve(
    <>
      <meta name="description" content="Yay, streaming" />
      <p>Lazy content</p>
    </>,
  );

  await expect(readToEnd(reader)).resolves.toBe(
    '<template for="srv-jsx-head"><meta name="description" content="Yay, streaming"><?marker name="srv-jsx-head"></template><template for="srv-jsx-1da935"><p>Lazy content</p></template>',
  );
});

test("emits Suspense templates in resolution order", async () => {
  const first = createDeferred<JSXChild>();
  const second = createDeferred<JSXChild>();
  const stream = await renderToReadableStream(
    <>
      <Suspense fallback={<p>First loading</p>}>{first.promise}</Suspense>
      <Suspense fallback={<p>Second loading</p>}>{second.promise}</Suspense>
    </>,
  );
  const reader = stream.getReader();

  await expect(readUntilLength(reader, orderedSuspenseShell.length)).resolves.toBe(
    orderedSuspenseShell,
  );

  second.resolve(<p>Second resolved</p>);

  await expect(readUntilLength(reader, secondTemplate.length)).resolves.toBe(secondTemplate);

  first.resolve(<p>First resolved</p>);

  await expect(readToEnd(reader)).resolves.toBe(
    '<template for="srv-jsx-vxhwgy"><p>First resolved</p></template>',
  );
});

test("ErrorBoundary replaces flushed content when a child component throws", async () => {
  const html = await renderToText(
    <ErrorBoundary fallback={<p>oops</p>}>
      <p>before</p>
      <Throws />
      <p>after</p>
    </ErrorBoundary>,
  );

  expect(html).toBe(
    '<?start name="srv-jsx-ezw52n"><p>before</p><?end><template for="srv-jsx-ezw52n"><p>oops</p></template>',
  );
});

test("ErrorBoundary discards detached head elements from failed children", async () => {
  const html = await renderToText(
    <html lang="en">
      <head>
        <meta charset="utf-8" />
      </head>
      <body>
        <ErrorBoundary fallback={<p>oops</p>}>
          <title>Bad</title>
          <Throws />
        </ErrorBoundary>
      </body>
    </html>,
  );

  expect(html).not.toContain("<title>Bad</title>");
  expect(html).not.toContain('<template for="srv-jsx-head">');
  expect(html).toContain("<p>oops</p>");
});

test("ErrorBoundary catches rejected async work inside a Suspense template", async () => {
  const deferred = createDeferred<JSXChild>();
  const stream = await renderToReadableStream(
    <ErrorBoundary fallback={<p>oops</p>}>
      <Suspense fallback={<p>loading</p>}>{deferred.promise}</Suspense>
    </ErrorBoundary>,
  );
  const reader = stream.getReader();
  const shell =
    '<?start name="srv-jsx-ezw52n"><?start name="srv-jsx-vxhwgy"><p>loading</p><?end><?end>';

  await expect(readUntilLength(reader, shell.length)).resolves.toBe(shell);

  deferred.reject(new Error("boom"));

  await expect(readToEnd(reader)).resolves.toBe(
    '<template for="srv-jsx-ezw52n"><p>oops</p></template>',
  );
});

test("throws shell errors from renderToReadableStream without calling onError", async () => {
  const error = new Error("boom");
  const errors: unknown[] = [];
  let streamCreated = false;

  await expect(
    renderToReadableStream(<div>{Promise.reject(error)}</div>, {
      onError(error) {
        errors.push(error);
      },
    }).then((stream) => {
      streamCreated = true;
      return stream;
    }),
  ).rejects.toBe(error);

  expect(streamCreated).toBe(false);
  expect(errors).toEqual([]);
});

test("calls onError for unhandled errors after the shell", async () => {
  const deferred = createDeferred<JSXChild>();
  const error = new Error("boom");
  const errors: unknown[] = [];
  const stream = await renderToReadableStream(
    <Suspense fallback={<p>loading</p>}>{deferred.promise}</Suspense>,
    {
      onError(error) {
        errors.push(error);
      },
    },
  );

  deferred.reject(error);

  await expect(readToEnd(stream.getReader())).resolves.toBe(
    '<?start name="srv-jsx-ezw52n"><p>loading</p><?end>',
  );
  expect(errors).toEqual([error]);
});

test("calls onError for handled errors after the shell", async () => {
  const deferred = createDeferred<JSXChild>();
  const error = new Error("boom");
  const errors: unknown[] = [];
  const stream = await renderToReadableStream(
    <ErrorBoundary fallback={<p>oops</p>}>
      <Suspense fallback={<p>loading</p>}>{deferred.promise}</Suspense>
    </ErrorBoundary>,
    {
      onError(error) {
        errors.push(error);
      },
    },
  );

  deferred.reject(error);

  await expect(readToEnd(stream.getReader())).resolves.toContain("<p>oops</p>");
  expect(errors).toEqual([error]);
});

test("unhandled Suspense errors close the stream without a template", async () => {
  const deferred = createDeferred<JSXChild>();
  const stream = await renderToReadableStream(
    <Suspense fallback={<p>loading</p>}>{deferred.promise}</Suspense>,
  );

  deferred.reject(new Error("boom"));

  await expect(readToEnd(stream.getReader())).resolves.toBe(
    '<?start name="srv-jsx-ezw52n"><p>loading</p><?end>',
  );
});

test("unhandled Suspense errors reject prerender", async () => {
  const deferred = createDeferred<JSXChild>();
  const error = new Error("boom");
  const errors: unknown[] = [];
  let streamCreated = false;
  const streamPromise = renderToReadableStream(
    <Suspense fallback={<p>loading</p>}>{deferred.promise}</Suspense>,
    {
      onError(error) {
        errors.push(error);
      },
      prerender: true,
    },
  ).then((stream) => {
    streamCreated = true;
    return stream;
  });

  deferred.reject(error);

  await expect(streamPromise).rejects.toBe(error);
  expect(streamCreated).toBe(false);
  expect(errors).toEqual([]);
});

test("prerender calls onError for errors caught by an ErrorBoundary", async () => {
  const deferred = createDeferred<JSXChild>();
  const error = new Error("boom");
  const errors: unknown[] = [];
  const streamPromise = renderToReadableStream(
    <ErrorBoundary fallback={<p>oops</p>}>
      <Suspense fallback={<p>loading</p>}>{deferred.promise}</Suspense>
    </ErrorBoundary>,
    {
      onError(error) {
        errors.push(error);
      },
      prerender: true,
    },
  );
  let resolved = false;

  void streamPromise.then(() => {
    resolved = true;
  });
  await settleMicrotasks();

  expect(resolved).toBe(false);

  deferred.reject(error);

  const stream = await streamPromise;

  await expect(readToEnd(stream.getReader())).resolves.toBe(
    '<?start name="srv-jsx-ezw52n"><?end><template for="srv-jsx-ezw52n"><p>oops</p></template>',
  );
  expect(errors).toEqual([error]);
});

test("AbortSignal aborts rendering while waiting for async children", async () => {
  const controller = new AbortController();
  const deferred = createDeferred<JSXChild>();
  const reason = new Error("stop rendering");
  const streamPromise = renderToReadableStream(deferred.promise, { signal: controller.signal });

  controller.abort(reason);

  await expect(streamPromise).rejects.toBe(reason);
});

test("AbortSignal closes the stream without a template", async () => {
  const controller = new AbortController();
  const deferred = createDeferred<JSXChild>();
  const reason = new Error("stop rendering");
  const stream = await renderToReadableStream(
    <Suspense fallback={<p>loading</p>}>{deferred.promise}</Suspense>,
    { signal: controller.signal },
  );

  controller.abort(reason);

  await expect(readToEnd(stream.getReader())).resolves.toBe(
    '<?start name="srv-jsx-ezw52n"><p>loading</p><?end>',
  );
});

test("canceling the stream stops pending rendering work", async () => {
  const deferred = createDeferred<JSXChild>();
  let renderedAfterCancel = false;
  const stream = await renderToReadableStream(
    <Suspense fallback={<p>loading</p>}>
      {deferred.promise}
      <AfterCancel />
    </Suspense>,
  );
  const reader = stream.getReader();

  await reader.cancel(new Error("client disconnected"));
  deferred.resolve(<p>too late</p>);
  await settleMicrotasks();

  expect(renderedAfterCancel).toBe(false);

  function AfterCancel(): JSXChild {
    renderedAfterCancel = true;
    return <p>after</p>;
  }
});

test("prerender waits for Suspense before resolving the stream", async () => {
  const deferred = createDeferred<JSXChild>();
  const streamPromise = renderToReadableStream(
    <div>
      <Suspense fallback={<p>loading</p>}>{deferred.promise}</Suspense>
      <p>after</p>
    </div>,
    { prerender: true },
  );
  let resolved = false;

  void streamPromise.then(() => {
    resolved = true;
  });
  await settleMicrotasks();

  expect(resolved).toBe(false);

  deferred.resolve(<p>ready</p>);
  const stream = await streamPromise;

  expect(resolved).toBe(true);
  await expect(readChunk(stream.getReader())).resolves.toBe("<div><p>ready</p><p>after</p></div>");
});

test("drains many Suspense templates in completion order", async () => {
  const deferreds = Array.from({ length: 30 }, () => createDeferred<JSXChild>());
  const stream = await renderToReadableStream(
    <>
      {deferreds.map((deferred, index) => (
        <Suspense fallback={<span>{`loading ${index}`}</span>}>{deferred.promise}</Suspense>
      ))}
    </>,
  );
  const reader = stream.getReader();

  await expect(readUntilIncludes(reader, "<span>loading 29</span><?end>")).resolves.toContain(
    "<span>loading 29</span><?end>",
  );

  for (const [index, deferred] of [...deferreds.entries()].reverse()) {
    deferred.resolve(<b>{`resolved ${index}`}</b>);
  }

  const html = await readToEnd(reader);

  expect(html.indexOf("<b>resolved 29</b>")).toBeLessThan(html.indexOf("<b>resolved 0</b>"));
  expect(html.match(/<template/g)?.length).toBe(30);
});

const suspenseShell =
  '<div><?start name="srv-jsx-4kgorb"><p>Loading...</p><?end></div><p>More content that isn\'t delayed</p>';
const orderedSuspenseShell =
  '<?start name="srv-jsx-vxhwgy"><p>First loading</p><?end><?start name="srv-jsx-zubyhh"><p>Second loading</p><?end>';
const secondTemplate = '<template for="srv-jsx-zubyhh"><p>Second resolved</p></template>';

function Throws(): JSXChild {
  throw new Error("boom");
}

async function renderToText(value: JSXChild, options?: RenderOptions) {
  const stream = await renderToReadableStream(value, options);
  return readToEnd(stream.getReader());
}

function clientReference(
  name: string,
  mod: string,
  bound?: readonly unknown[],
): ClientReferenceValue {
  return defineClientReference({
    bound,
    deps: [],
    id: `${mod}#${name}`,
    mod,
    name,
  });
}

async function readUntilLength(reader: ReadableStreamDefaultReader<Uint8Array>, length: number) {
  let html = "";

  while (html.length < length) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    html += new TextDecoder().decode(value);
  }

  return html;
}

async function readUntilIncludes(reader: ReadableStreamDefaultReader<Uint8Array>, text: string) {
  let html = "";

  while (!html.includes(text)) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    html += new TextDecoder().decode(value);
  }

  return html;
}

async function readChunk(reader: ReadableStreamDefaultReader<Uint8Array>) {
  const { done, value } = await reader.read();

  if (done) {
    return "";
  }

  return new TextDecoder().decode(value);
}

async function readToEnd(reader: ReadableStreamDefaultReader<Uint8Array>) {
  let html = "";

  for (;;) {
    const { done, value } = await reader.read();

    if (done) {
      return html;
    }

    html += new TextDecoder().decode(value);
  }
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });

  return { promise, reject, resolve };
}

async function settleMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}
