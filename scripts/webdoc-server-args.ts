export type ServerMode = "dev" | "start";

export function buildNextArgs(mode: ServerMode, server: { host: string; port: number }): string[] {
  return [mode, "--hostname", server.host, "--port", String(server.port)];
}

type ShutdownChild = {
  kill(signal: NodeJS.Signals): boolean;
  once(event: "exit", listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
};

type ShutdownParent = {
  on(signal: "SIGINT" | "SIGTERM", listener: () => void): unknown;
  off(signal: "SIGINT" | "SIGTERM", listener: () => void): unknown;
  exitCode?: string | number | null;
};

const signalExitCodes = { SIGINT: 130, SIGTERM: 143 } as const;

export function installChildShutdown(
  child: ShutdownChild,
  parent: ShutdownParent = process,
  timeoutMs = 3_000,
): void {
  let requestedSignal: keyof typeof signalExitCodes | undefined;
  let forceTimer: ReturnType<typeof setTimeout> | undefined;

  const removeSignalHandlers = () => {
    parent.off("SIGINT", onSigint);
    parent.off("SIGTERM", onSigterm);
  };
  const requestShutdown = (signal: keyof typeof signalExitCodes) => {
    if (requestedSignal) {
      child.kill("SIGKILL");
      return;
    }
    requestedSignal = signal;
    if (!child.kill(signal)) {
      parent.exitCode = signalExitCodes[signal];
      removeSignalHandlers();
      return;
    }
    forceTimer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
  };
  const onSigint = () => requestShutdown("SIGINT");
  const onSigterm = () => requestShutdown("SIGTERM");

  parent.on("SIGINT", onSigint);
  parent.on("SIGTERM", onSigterm);
  child.once("exit", (code, signal) => {
    if (forceTimer) clearTimeout(forceTimer);
    removeSignalHandlers();
    parent.exitCode = code ?? (requestedSignal ? signalExitCodes[requestedSignal] : signal === "SIGINT" ? 130 : signal === "SIGTERM" ? 143 : 1);
  });
}
