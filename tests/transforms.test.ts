import { expect, test } from "vite-plus/test";
import { parseAst } from "vite";

import {
  analyzeUseClientDirectives,
  replaceClientReferencePlaceholders,
  transformUseClientForClient,
  transformUseClientForServer,
  type ClientReference,
} from "../src/transforms.ts";

function parse(code: string) {
  return parseAst(code, { lang: "tsx" }) as unknown as Parameters<
    typeof analyzeUseClientDirectives
  >[1];
}

function serverTransform(code: string, reference?: ClientReference) {
  return transformUseClientForServer(code, parse(code), {
    id: "/project/src/mod.tsx",
    root: "/project",
    references: reference ? new Map([["/project/src/mod.tsx", reference]]) : undefined,
  });
}

function serverPlaceholderTransform(code: string) {
  return transformUseClientForServer(code, parse(code), {
    id: "/project/src/mod.tsx",
    root: "/project",
    placeholders: true,
  });
}

function clientTransform(code: string) {
  return transformUseClientForClient(code, parse(code), {
    id: "/project/src/mod.tsx",
    root: "/project",
  });
}

function referenceId(mod: string, name: string) {
  let hash = 5381;
  for (let index = 0; index < `${mod}#${name}`.length; index++) {
    hash = (hash * 33) ^ `${mod}#${name}`.charCodeAt(index);
  }
  return (hash >>> 0).toString(36).padStart(6, "0").slice(0, 6);
}

test("server transform rewrites module-level directives to client references", () => {
  const result = serverTransform(
    `
"use client";

export const Button = () => "button";
export { Button as Renamed };
export default function DefaultButton() {
  return "default";
}
`,
    {
      mod: "/assets/mod-a1b2c3.js",
      deps: ["/assets/helper-d4e5f6.js"],
    },
  );

  expect(result?.code).toBe(
    `import { defineClientReference as __srv_jsx_define_client_reference } from "srv-jsx";
const __srv_jsx_client_reference_0 = __srv_jsx_define_client_reference({ id: "${referenceId("/assets/mod-a1b2c3.js", "Button")}", name: "Button", mod: "/assets/mod-a1b2c3.js", deps: ["/assets/helper-d4e5f6.js"] });
const __srv_jsx_client_reference_1 = __srv_jsx_define_client_reference({ id: "${referenceId("/assets/mod-a1b2c3.js", "Renamed")}", name: "Renamed", mod: "/assets/mod-a1b2c3.js", deps: ["/assets/helper-d4e5f6.js"] });
const __srv_jsx_client_reference_2 = __srv_jsx_define_client_reference({ id: "${referenceId("/assets/mod-a1b2c3.js", "default")}", name: "default", mod: "/assets/mod-a1b2c3.js", deps: ["/assets/helper-d4e5f6.js"] });
export { __srv_jsx_client_reference_0 as Button, __srv_jsx_client_reference_1 as Renamed };
export default __srv_jsx_client_reference_2;
`,
  );
  expect(result?.map).toBeTruthy();
});

test("server transform replaces inline implementations with deterministic references", () => {
  const result = serverTransform(
    `
import { helper } from "./helper";

export function Page() {
  const Button = () => {
    "use client";
    return helper();
  };

  return Button;
}
`,
    {
      mod: "/assets/mod.js",
      deps: [],
    },
  );

  expect(result?.code).toContain(
    `const __srv_jsx_client_0 = __srv_jsx_define_client_reference({ id: "${referenceId("/assets/mod.js", "__srv_jsx_client_0")}", name: "__srv_jsx_client_0", mod: "/assets/mod.js", deps: [] });`,
  );
  expect(result?.code).toContain(
    'import { defineClientReference as __srv_jsx_define_client_reference } from "srv-jsx";',
  );
  expect(result?.code).toContain("export { __srv_jsx_client_0 };");
  expect(result?.code).toContain("const Button = __srv_jsx_client_0;");
  expect(result?.code).not.toContain("return helper();");
});

test("inline client IDs increment per file in source order", () => {
  const result = serverTransform(`
export function Page() {
  const First = () => {
    "use client";
  };
  const Second = () => {
    "use client";
  };
  return [First, Second];
}
`);

  expect(result?.code).toContain("export { __srv_jsx_client_0, __srv_jsx_client_1 };");
  expect(result?.code).toContain("const First = __srv_jsx_client_0;");
  expect(result?.code).toContain("const Second = __srv_jsx_client_1;");
});

test("server transform binds server-scope captures for inline client functions", () => {
  const result = serverTransform(`
export function handler(request: Request) {


  console.log(() => {
    "use client";
    console.log(request.url);
  });
}
`);

  expect(result?.code).toContain("console.log(__srv_jsx_client_0.bind(null,request.url));");
});

test("server transform can emit client reference placeholders for bundle patching", () => {
  const result = serverPlaceholderTransform(`
"use client";

export const Button = () => "button";
`);

  expect(result?.code).toContain("mod: __SRV_JSX_CLIENT_REFERENCE_");
  expect(result?.code).toContain("deps: __SRV_JSX_CLIENT_REFERENCE_");
  expect(result?.code).toContain("id: __SRV_JSX_CLIENT_REFERENCE_");
  expect(result?.code).toContain('name: "Button"');
  expect(result?.code).toContain("defineClientReference");

  const patched = replaceClientReferencePlaceholders(
    result!.code,
    new Map([
      [
        "/project/src/mod.tsx",
        {
          mod: "/assets/mod-a1b2c3.js",
          deps: ["/assets/dep-d4e5f6.js"],
        },
      ],
    ]),
  );

  expect(patched).toContain('mod: "/assets/mod-a1b2c3.js"');
  expect(patched).toContain('deps: ["/assets/dep-d4e5f6.js"]');
  expect(patched).toContain(`id: "${referenceId("/assets/mod-a1b2c3.js", "Button")}"`);
  expect(patched).toContain('name: "Button"');
  expect(patched).not.toContain("__SRV_JSX_CLIENT_REFERENCE_");
});

test("placeholder replacement fails when the client build did not emit a reference", () => {
  const result = serverPlaceholderTransform(`
"use client";

export const Button = () => "button";
`);

  expect(() => replaceClientReferencePlaceholders(result!.code, new Map())).toThrow(
    "Missing client reference for placeholder",
  );
});

test("client transform hoists inline client functions and prunes server-only code", () => {
  const result = clientTransform(
    `
import defaultUsed, { used, unused } from "./dep";
import sideEffect from "./side-effect";

const value = "client";
const serverOnly = unused();

function helper() {
  return used(value, defaultUsed);
}

export function Page() {
  const Button = () => {
    "use client";
    return <button>{helper()}</button>;
  };

  return <Button />;
}
`,
  );

  expect(result?.code).toContain('import defaultUsed, { used } from "./dep";');
  expect(result?.code).toContain('const value = "client";');
  expect(result?.code).toContain("function helper()");
  expect(result?.code).toContain("export const __srv_jsx_client_0 = () => {");
  expect(result?.code).toContain("return <button>{helper()}</button>;");
  expect(result?.code).not.toContain("unused");
  expect(result?.code).not.toContain("sideEffect");
  expect(result?.code).not.toContain("serverOnly");
  expect(result?.map).toBeTruthy();
});

test("client transform rewrites bound server-scope captures to parameters", () => {
  const result = clientTransform(`
export function handler(request: Request) {


  console.log(() => {
    "use client";
    console.log(request.url);
  });
}
`);

  expect(result?.code).toContain("export const __srv_jsx_client_0 = (__srv_jsx_bind_0) => {");
  expect(result?.code).toContain("console.log(__srv_jsx_bind_0);");
  expect(result?.code).not.toContain("request.url");
});

test("client transform removes module-level directives while preserving implementations", () => {
  const result = clientTransform(`
"use client";
import { helper } from "./helper";

export function Button() {
  return helper();
}
`);

  expect(result?.code).not.toContain('"use client"');
  expect(result?.code).toContain('import { helper } from "./helper";');
  expect(result?.code).toContain("export function Button()");
});

test("module-level and inline directives cannot be mixed", () => {
  const code = `
"use client";

export function Button() {
  "use client";
  return "button";
}
`;

  expect(() => analyzeUseClientDirectives(code, parse(code))).toThrow(
    'Cannot use module-level and inline "use client" directives in the same file.',
  );
});
