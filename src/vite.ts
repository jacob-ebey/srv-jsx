import { mergeConfig } from "vite";
import type { Plugin, ResolvedConfig, ViteBuilder } from "vite";

import {
  analyzeUseClientDirectives,
  cleanId,
  isJavaScriptId,
  patchClientReferencePlaceholdersInBundle,
  publicOutputPath,
  transformUseClientForClient,
  transformUseClientForServer,
  type AstProgram,
  type ClientReference,
} from "./transforms.ts";

type Options = {
  clientEnvironment?: string;
  serverEnvironments?: string[];
};

type BuildState = {
  builder: ViteBuilder;
  clientEnvironment: string;
  serverEnvironmentNames: Set<string>;
  serverEnvironmentsAtGenerateBundle: Set<string>;
  clientBuild: PromiseWithResolvers<void>;
  clientBuildStart?: Promise<void>;
};

export default function srvJsx(options?: Options) {
  const clientEnvironment = options?.clientEnvironment ?? "client";
  const serverEnvironments = new Set(options?.serverEnvironments ?? ["ssr"]);
  const clientReferences = new Map<string, ClientReference>();
  const directiveFiles = new Set<string>();
  let config: ResolvedConfig | undefined;
  let buildState: BuildState | undefined;

  return {
    name: "srv-jsx",
    sharedDuringBuild: true,
    perEnvironmentStartEndDuringDev: true,
    configResolved(resolvedConfig) {
      config = resolvedConfig;
    },
    configEnvironment(name, userConfig) {
      if (name !== clientEnvironment) return;
      return mergeConfig(
        {
          build: {
            rolldownOptions: {
              preserveEntrySignatures: "exports-only",
            },
          },
        } as typeof userConfig,
        userConfig,
      );
    },
    config: {
      order: "post",
      handler(userConfig) {
        return mergeConfig(
          {
            builder: {
              async buildApp(builder) {
                await buildEnvironmentsServerFirst(
                  builder,
                  clientEnvironment,
                  serverEnvironments,
                  (state) => {
                    buildState = state;
                  },
                );
              },
            },
          } satisfies typeof userConfig,
          userConfig,
        );
      },
    },
    buildApp: {
      order: "pre",
      async handler(builder) {
        await buildEnvironmentsServerFirst(
          builder,
          clientEnvironment,
          serverEnvironments,
          (state) => {
            buildState = state;
          },
        );
      },
    },
    options(inputOptions) {
      if (this.environment.name !== clientEnvironment) return null;
      if (directiveFiles.size === 0) return null;

      return {
        ...inputOptions,
        input: addClientInputs(inputOptions.input, directiveFiles) as typeof inputOptions.input,
      };
    },
    async generateBundle(_outputOptions, bundle) {
      const currentConfig = config;
      const environmentName = this.environment.name;

      if (environmentName === clientEnvironment && currentConfig) {
        for (const output of Object.values(bundle)) {
          if (output.type !== "chunk" || !output.facadeModuleId) continue;

          const id = cleanId(output.facadeModuleId);
          if (!directiveFiles.has(id)) continue;

          clientReferences.set(id, {
            mod: publicOutputPath(output.fileName, currentConfig.base),
            deps: output.imports.map((fileName) => publicOutputPath(fileName, currentConfig.base)),
          });
        }
        return;
      }

      if (!serverEnvironments.has(environmentName)) return;

      if (buildState?.serverEnvironmentNames.has(environmentName)) {
        await waitForClientBuildFromServerGenerateBundle(buildState, environmentName);
        patchClientReferencePlaceholdersInBundle(bundle, clientReferences);
      }
    },
    transform(code, id) {
      if (!code.includes("use client")) return null;

      const cleanModuleId = cleanId(id);
      if (!isJavaScriptId(cleanModuleId)) return null;

      const ast = this.parse(code) as unknown as AstProgram;
      const analysis = analyzeUseClientDirectives(code, ast);
      if (!analysis.moduleDirective && analysis.inlineDirectives.length === 0) return null;

      directiveFiles.add(cleanModuleId);

      const transformOptions = {
        id: cleanModuleId,
        root: config?.root,
        base: config?.base,
        references: clientReferences,
        placeholders: buildState?.serverEnvironmentNames.has(this.environment.name),
      };

      if (this.environment.name === clientEnvironment) {
        return transformUseClientForClient(code, ast, transformOptions);
      }

      if (serverEnvironments.has(this.environment.name)) {
        return transformUseClientForServer(code, ast, transformOptions);
      }

      return null;
    },
  } satisfies Plugin;
}

function buildEnvironmentsServerFirst(
  builder: ViteBuilder,
  clientEnvironment: string,
  serverEnvironments: Set<string>,
  setBuildState: (state: BuildState | undefined) => void,
) {
  return (async () => {
    const serverEnvironmentNames = new Set(
      [...serverEnvironments].filter(
        (name) => builder.environments[name] && !builder.environments[name].isBuilt,
      ),
    );
    const buildState: BuildState = {
      builder,
      clientEnvironment,
      serverEnvironmentNames,
      serverEnvironmentsAtGenerateBundle: new Set(),
      clientBuild: Promise.withResolvers<void>(),
    };

    setBuildState(buildState);
    try {
      if (serverEnvironmentNames.size > 0) {
        await Promise.all(
          [...serverEnvironmentNames].map((name) => builder.build(builder.environments[name]!)),
        );
      } else {
        startClientBuild(buildState);
        await buildState.clientBuild.promise;
      }

      for (const environment of Object.values(builder.environments)) {
        if (!environment.isBuilt) {
          await builder.build(environment);
        }
      }
    } finally {
      setBuildState(undefined);
    }
  })();
}

function waitForClientBuildFromServerGenerateBundle(
  buildState: BuildState,
  environmentName: string,
) {
  buildState.serverEnvironmentsAtGenerateBundle.add(environmentName);

  if (
    buildState.serverEnvironmentsAtGenerateBundle.size === buildState.serverEnvironmentNames.size
  ) {
    startClientBuild(buildState);
  }

  return buildState.clientBuild.promise;
}

function startClientBuild(buildState: BuildState) {
  if (buildState.clientBuildStart) return;

  const client = buildState.builder.environments[buildState.clientEnvironment];
  if (!client || client.isBuilt) {
    buildState.clientBuild.resolve();
    buildState.clientBuildStart = buildState.clientBuild.promise;
    return;
  }

  buildState.clientBuildStart = buildState.builder.build(client).then(
    () => {
      buildState.clientBuild.resolve();
    },
    (error: unknown) => {
      buildState.clientBuild.reject(error);
    },
  );
}

function addClientInputs(input: unknown, files: Set<string>) {
  if (files.size === 0) return input;

  const entries = [...files].sort();

  if (typeof input === "string") return [input, ...entries];
  if (Array.isArray(input)) return [...input, ...entries];

  const objectInput: Record<string, unknown> =
    input && typeof input === "object" ? { ...input } : {};
  for (const file of entries) {
    objectInput[`srv-jsx-client-${hashString(file)}`] = file;
  }
  return objectInput;
}

function hashString(value: string) {
  let hash = 5381;
  for (let index = 0; index < value.length; index++) {
    hash = (hash * 33) ^ value.charCodeAt(index);
  }
  return (hash >>> 0).toString(36);
}
