import { createServer } from "node:http";

import { staticFiles } from "remix/static-middleware";
import { createRouter } from "remix/fetch-router";
import { createRequestListener } from "remix/node-fetch-server";

import build from "#build";

const router = createRouter({
  middleware: [staticFiles("./dist/client")],
});

router.route("ANY", "*", ({ request }) => build.fetch(request));

const server = createServer(createRequestListener((request) => router.fetch(request)));

const port = Number.parseInt(process.env.PORT || "3000");
server.listen(port, () => {
  console.log(`Server is listening at http://localhost:${port}`);
});
