# srv-jsx

Server-only JSX for native, declarative out-of-order HTML streaming.

srv-jsx renders JSX to a `ReadableStream<Uint8Array>`. It is designed for the new
browser streaming model built around `<?start name="...">`, `<?end>`, and
`<template for="...">`, where the browser can show fallback HTML immediately and
replace it later when a matching template arrives.

## Goals

- Server-only JSX runtime with no client event callbacks.
- String-based HTML attributes, including string CSS via `style="..."`.
- Raw HTML insertion through `innerHTML`, instead of React's
  `dangerouslySetInnerHTML` object shape.
- `<Suspense>` output that maps directly to processing instructions and
  `<template for>` chunks.
- `<ErrorBoundary>` output that flushes wrapped content as it renders and emits a
  replacement template if the wrapped tree fails.
- Small rendering surface: `renderToReadableStream()` returns the response body
  once the shell is ready.

## JSX setup

Use srv-jsx as the JSX import source:

```json
{
  "compilerOptions": {
    "jsx": "react-jsx",
    "jsxImportSource": "srv-jsx"
  }
}
```

Then import runtime helpers from `srv-jsx`:

```tsx
import { Suspense, renderToReadableStream } from "srv-jsx";

async function Message() {
  return <p>Hello, World!</p>;
}

const body = await renderToReadableStream(
  <>
    <div>
      <Suspense fallback={<p>Loading...</p>}>{Message()}</Suspense>
    </div>
    <p>More content that isn't delayed</p>
  </>,
);

return new Response(body, {
  headers: { "content-type": "text/html; charset=utf-8" },
});
```

`renderToReadableStream()` resolves after the shell has been buffered, so the
first body chunk contains fallback placeholders for pending Suspense boundaries.
Pending Suspense children are emitted later as replacement templates. Pass
`{ prerender: true }` to render Suspense children inline without fallback
placeholders or replacement templates.

The first chunk contains the shell:

```text
<div><?start name="srv-jsx-4kgorb"><p>Loading...</p><?end></div><p>More content that isn't delayed</p>
```

When the async child resolves, srv-jsx emits the replacement template:

```text
<template for="srv-jsx-4kgorb"><p>Hello, World!</p></template>
```

## Attribute model

Attributes render as escaped HTML strings:

```tsx
<p class="lede" style="color: red" data-id="intro">
  Hello
</p>
```

Supported attribute values are strings, numbers, booleans, `null`, and
`undefined`. Function callbacks and object values are rejected at render time.
That means no `onClick={() => ...}` and no `style={{ color: "red" }}`.

`className` is rendered as `class`, and `htmlFor` is rendered as `for`.

## Raw HTML

Use `innerHTML` when a component owns already-sanitized HTML:

```tsx
<article innerHTML="<p>Already sanitized HTML</p>" />
```

An element cannot use both `innerHTML` and children.

## Suspense

`<Suspense>` accepts `fallback` and `children`.

```tsx
<Suspense fallback={<p>Loading profile...</p>}>{loadProfile()}</Suspense>
```

The fallback is emitted inside a generated `<?start name="...">...<?end>`
boundary. The children are rendered into a matching `<template for="...">` once
they resolve. Multiple boundaries are emitted in resolution order, so faster
async work can update the browser before slower work that appeared earlier in
the document.

Boundary names are generated deterministically by hashing the boundary's
location in the rendered tree. They are not user-provided. Pass
`{ idPrefix: "..." }` to `renderToReadableStream()` to customize the generated
name prefix.

Pass `{ nonce: "..." }` to add a CSP nonce to the inline scripts srv-jsx
generates itself: client reference event handlers, refs, and
`bootstrapScripts`/`bootstrapModules` (see below). This matches React's
`renderToReadableStream()`/`renderToPipeableStream()` behavior, where `nonce`
only applies to scripts React emits.

`nonce` is a plain attribute everywhere else. srv-jsx never adds it to
elements you author yourself, so if you want the same nonce value on your
own `<script>`, `<link>`, or `<style>` tags, pass it explicitly, you already
have the value in scope wherever you call `renderToReadableStream()`:

```tsx
const nonce = crypto.randomUUID();

await renderToReadableStream(<style nonce={nonce}>{".hidden{display:none}"}</style>, { nonce });
```

Use `bootstrapScripts` and `bootstrapModules` to append `<script>` tags after
the rendered document, aligned with React's options of the same names. Each
URL is rendered with the configured nonce and a bare `async` attribute:

```ts
await renderToReadableStream(<App />, {
  bootstrapScripts: ["/assets/app.js"],
  bootstrapModules: ["/assets/app.mjs"],
  nonce,
});
```

```html
<script src="/assets/app.js" nonce="..." async></script>
<script type="module" src="/assets/app.mjs" nonce="..." async></script>
```

DOM elements can receive a client reference as `ref`. The runtime emits an
inline script after the element and calls the loaded reference with that element.

## ErrorBoundary

`<ErrorBoundary>` accepts `fallback` and `children`.

```tsx
<ErrorBoundary fallback={<p>oops</p>}>
  <Profile />
</ErrorBoundary>
```

The boundary emits a generated `<?start name="...">` before rendering its
children and `<?end>` after them. If a child component throws or async work
inside the boundary rejects, srv-jsx emits a replacement template for the boundary:

```text
<template for="srv-jsx-ezw52n"><p>oops</p></template>
```

That lets the browser show already-flushed content first, then replace the whole
wrapped region with the fallback if rendering fails.

## API

```ts
renderToReadableStream(
  value,
  options?,
): Promise<ReadableStream<Uint8Array>>
```

Options include `bootstrapModules`, `bootstrapScripts`, `encodeLoadReference`,
`idPrefix`, `nonce`, `onError`, `prerender`, and `signal`. `onError(error)` is
called for errors that happen after the shell has been flushed, and for
errors that are caught by an `ErrorBoundary`. Unhandled errors while building
the shell, including unhandled `prerender` errors, reject
`renderToReadableStream()` before a stream is created.

## Development

Install dependencies:

```bash
vp install
```

Run checks and tests:

```bash
vp check
vp test
```

Build the package:

```bash
vp pack
```
