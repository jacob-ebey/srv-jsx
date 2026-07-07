import { Suspense } from "srv-jsx";
import { createAction } from "remix/fetch-router";

import { routes } from "@/routes.ts";

export default createAction(routes.partial, ({ render }) => {
  return render(
    <Suspense fallback={<p>Fallback...</p>}>
      <Partial></Partial>
    </Suspense>,
  );
});

async function Partial() {
  await new Promise((resolve) => setTimeout(resolve, 500));
  return <p>Dynamically loaded</p>;
}
