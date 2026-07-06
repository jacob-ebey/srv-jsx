import { createAction } from "remix/fetch-router";

import { Document } from "@/components/document.tsx";
import { routes } from "@/routes.ts";

export default createAction(routes.home, ({ render }) => {
  return render(
    <Document>
      <NotFound />
    </Document>,
    { status: 404 },
  );
});

function NotFound() {
  return (
    <>
      <title>srv-jsx + Vite</title>
      <h1>404</h1>
      <p>Page not found</p>
    </>
  );
}
