import { resolve } from "node:path";

import { loadConfig, type WebDocConfig } from "../config/load";
import { DocumentRepository } from "../repository/repository";

export type ServerContext = { config: WebDocConfig; repository: DocumentRepository };

let contextPromise: Promise<ServerContext> | undefined;

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

async function createServerContext(configPath: string): Promise<ServerContext> {
  const config = await loadConfig(configPath);
  return { config, repository: new DocumentRepository() };
}
