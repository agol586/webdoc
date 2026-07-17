import { resolve } from "node:path";

import { loadConfig, type WebDocConfig } from "../config/load";
import { DocumentRepository } from "../repository/repository";
import { changeHub } from "../live/change-hub";
import { ProjectWatcher } from "../live/watcher";

export type ServerContext = { config: WebDocConfig; repository: DocumentRepository };

let contextPromise: Promise<ServerContext> | undefined;
type LiveRuntime = { hub: typeof changeHub; watcher: ProjectWatcher };
const globalServer = globalThis as typeof globalThis & { __webdocLiveRuntime?: Promise<LiveRuntime> };

export function getServerContext(): Promise<ServerContext> {
  if (!contextPromise) {
    const pending = createServerContext(
      process.env.WEBDOC_CONFIG ?? resolve(process.cwd(), "webdoc.config.yaml"),
    );
    const wrapped = pending.catch((error: unknown) => {
      if (contextPromise === wrapped) contextPromise = undefined;
      throw error;
    });
    contextPromise = wrapped;
  }
  return contextPromise;
}

export function getLiveRuntime(): Promise<LiveRuntime> {
  return globalServer.__webdocLiveRuntime ??= (async () => {
    const context = await getServerContext();
    const configPath = process.env.WEBDOC_CONFIG ?? resolve(process.cwd(), "webdoc.config.yaml");
    const watcher = new ProjectWatcher(context, changeHub, configPath);
    await watcher.start(context.config);
    return { hub: changeHub, watcher };
  })().catch((error: unknown) => {
    globalServer.__webdocLiveRuntime = undefined;
    throw error;
  });
}

async function createServerContext(configPath: string): Promise<ServerContext> {
  const config = await loadConfig(configPath);
  return { config, repository: new DocumentRepository() };
}
