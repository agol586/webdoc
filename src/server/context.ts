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

  const teardown = (async () => {
    await current?.teardown;
    if (!current?.runtimePromise) return;
    try {
      const runtime = await current.runtimePromise;
      await runtime.watcher.close();
    } catch {}
  })();
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
    if (globalServer.__webdocServerHolder !== holder) throw new Error("Server runtime was superseded");
    const context = await holder.contextPromise;
    if (globalServer.__webdocServerHolder !== holder) throw new Error("Server runtime was superseded");
    const watcher = new ProjectWatcher(context, changeHub, holder.configPath);
    await watcher.start(context.config);
    if (globalServer.__webdocServerHolder !== holder) {
      await watcher.close();
      throw new Error("Server runtime was superseded");
    }
    changeHub.publish({ kind: "status", status: "connected" });
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
