export type ServerMode = "dev" | "start";

export function buildNextArgs(mode: ServerMode, server: { host: string; port: number }): string[] {
  return [mode, "--hostname", server.host, "--port", String(server.port)];
}
