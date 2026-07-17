import { resolve } from "node:path";

import { loadConfig, type WebDocConfig } from "../config/load";
import { DocumentRepository } from "../repository/repository";

export type ServerContext = { config: WebDocConfig; repository: DocumentRepository };

let contextPromise: Promise<ServerContext> | undefined;

export function getServerContext(): Promise<ServerContext> {
  contextPromise ??= createServerContext(
    process.env.WEBDOC_CONFIG ?? resolve(process.cwd(), "webdoc.config.yaml"),
  );
  return contextPromise;
}

async function createServerContext(configPath: string): Promise<ServerContext> {
  const config = await loadConfig(configPath);
  return { config, repository: new DocumentRepository() };
}
