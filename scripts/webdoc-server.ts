import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { resolve } from "node:path";

import { loadConfig } from "../src/config/load";
import { buildNextArgs, type ServerMode } from "./webdoc-server-args";

async function main(): Promise<void> {
  const mode = process.argv[2];
  if (mode !== "dev" && mode !== "start") throw new Error("Usage: webdoc-server <dev|start>");

  const configPath = resolve(process.env.WEBDOC_CONFIG ?? resolve(process.cwd(), "webdoc.config.yaml"));
  const config = await loadConfig(configPath);
  const require = createRequire(import.meta.url);
  const nextCli = require.resolve("next/dist/bin/next");
  const child = spawn(process.execPath, [nextCli, ...buildNextArgs(mode as ServerMode, config.server)], {
    env: process.env,
    stdio: "inherit",
  });

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => child.kill(signal));
  }

  child.on("error", (error) => {
    console.error("Failed to start Next.js", error);
    process.exitCode = 1;
  });
  child.on("exit", (code) => {
    process.exitCode = code ?? 1;
  });
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
