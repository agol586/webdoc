import { resolve } from "node:path";

import { loadConfig, type WebDocConfig } from "../config/load";
import { DocumentRepository } from "../repository/repository";
import { changeHub } from "../live/change-hub";
import { ProjectWatcher } from "../live/watcher";

export type ServerContext = { config: WebDocConfig; repository: DocumentRepository };

type LiveRuntime = { hub: typeof changeHub; watcher: ProjectWatcher; context: ServerContext };
type ServerHolder = {
  configPath: string;
  contextPromise: Promise<ServerContext>;
  runtimePromise?: Promise<LiveRuntime>;
  teardown: Promise<unknown>;
};
const globalServer = globalThis as typeof globalThis & { __webdocServerHolder?: ServerHolder };

function currentConfigPath(): string {
  return resolve(process.env.WEBDOC_CONFIG ?? resolve(process.cwd(), "webdoc.config.yaml"));
}

function getHolder(): ServerHolder {
  const configPath = currentConfigPath();
  const current = globalServer.__webdocServerHolder;
  if (current?.configPath === configPath) return current;

  const teardown = current?.runtimePromise?.then(
    (runtime) => runtime.watcher.close(),
    () => undefined,
  ) ?? Promise.resolve();
  const holder = {} as ServerHolder;
  holder.configPath = configPath;
  holder.teardown = teardown;
  holder.contextPromise = createServerContext(configPath).catch((error: unknown) => {
    if (globalServer.__webdocServerHolder === holder) globalServer.__webdocServerHolder = undefined;
    throw error;
  });
  globalServer.__webdocServerHolder = holder;
  return holder;
}

export function getServerContext(): Promise<ServerContext> {
  return getHolder().contextPromise;
}

export function getLiveRuntime(): Promise<LiveRuntime> {
  const holder = getHolder();
  return holder.runtimePromise ??= (async () => {
    await holder.teardown;
    const context = await holder.contextPromise;
    const watcher = new ProjectWatcher(context, changeHub, holder.configPath);
    await watcher.start(context.config);
    return { hub: changeHub, watcher, context };
  })().catch((error: unknown) => {
    if (globalServer.__webdocServerHolder === holder) holder.runtimePromise = undefined;
    throw error;
  });
}

async function createServerContext(configPath: string): Promise<ServerContext> {
  const config = await loadConfig(configPath);
  return { config, repository: new DocumentRepository() };
}
