import { createAction } from "remix/fetch-router";
import { Suspense } from "srv-jsx";

import { Document } from "@/components/document.tsx";
import { routes } from "@/routes.ts";

export default createAction(routes.home, ({ render }) => {
  return render(
    <Document>
      <Home />
    </Document>,
  );
});

function Home() {
  return (
    <>
      <title>srv-jsx + Vite</title>
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
        <button
          onclick={(event) => {
            "use client";
            const button = event.currentTarget as HTMLButtonElement;
            const target = button.nextElementSibling as HTMLDivElement;
            if (target.hasAttribute("data-loading")) return;

            target.setAttribute("data-loading", "");
            button.textContent = "Loading...";
            fetch(routes.partial.href())
              .then(async (res) => {
                if (!res.ok || !res.body) throw new Error("Bad response");
                const stream = target.streamHTMLUnsafe({ runScripts: true });
                await res.body.pipeThrough(new TextDecoderStream()).pipeTo(stream);
              })
              .catch(() => {
                target.innerHTML = "<p>Failed to load</p>";
              })
              .finally(() => {
                target.removeAttribute("data-loading");
                button.textContent = "Load Partial";
              });
          }}
        >
          Load Partial
        </button>
        <div>
          <p>No content.</p>
        </div>
      </main>
    </>
  );
}

async function Message() {
  await new Promise((resolve) => setTimeout(resolve, 250));
  return <p>Streamed server content is ready.</p>;
}
