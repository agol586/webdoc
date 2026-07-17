export type ChangeEvent = {
  kind: "project" | "config" | "status";
  projectId?: string;
  path?: string;
  status?: "connected" | "degraded";
};

type Subscriber = {
  queue: ChangeEvent[];
  waiting?: (result: IteratorResult<ChangeEvent>) => void;
  closed: boolean;
  cleanup: () => void;
};

const MAX_PENDING_EVENTS = 100;

export class ChangeHub {
  private readonly subscribers = new Set<Subscriber>();
  private health: "connected" | "degraded" = "connected";

  get subscriberCount(): number {
    return this.subscribers.size;
  }

  publish(event: ChangeEvent): void {
    if (event.kind === "status" && event.status) this.health = event.status;
    for (const subscriber of this.subscribers) {
      if (subscriber.waiting) {
        const resolve = subscriber.waiting;
        subscriber.waiting = undefined;
        resolve({ done: false, value: event });
      } else {
        this.enqueue(subscriber.queue, event);
      }
    }
  }

  private enqueue(queue: ChangeEvent[], event: ChangeEvent): void {
    const same = event.kind === "project"
      ? queue.findIndex((queued) => queued.kind === "project" && queued.projectId === event.projectId && queued.path === event.path)
      : queue.findIndex((queued) => queued.kind === event.kind);
    if (same >= 0) queue.splice(same, 1);
    if (queue.length === MAX_PENDING_EVENTS) {
      const project = queue.findIndex((queued) => queued.kind === "project");
      queue.splice(project >= 0 ? project : 0, 1);
    }
    queue.push(event);
  }

  subscribe(signal: AbortSignal): AsyncIterable<ChangeEvent> {
    const subscriber: Subscriber = { queue: [{ kind: "status", status: this.health }], closed: false, cleanup: () => undefined };
    const close = () => {
      if (subscriber.closed) return;
      subscriber.closed = true;
      this.subscribers.delete(subscriber);
      signal.removeEventListener("abort", close);
      subscriber.waiting?.({ done: true, value: undefined });
      subscriber.waiting = undefined;
      subscriber.queue.length = 0;
    };
    subscriber.cleanup = close;
    if (signal.aborted) close();
    else {
      this.subscribers.add(subscriber);
      signal.addEventListener("abort", close, { once: true });
    }

    return {
      [Symbol.asyncIterator]() {
        return {
          next: () => {
            if (subscriber.queue.length) return Promise.resolve({ done: false as const, value: subscriber.queue.shift()! });
            if (subscriber.closed) return Promise.resolve({ done: true as const, value: undefined });
            return new Promise<IteratorResult<ChangeEvent>>((resolve) => { subscriber.waiting = resolve; });
          },
          return: async () => {
            close();
            return { done: true as const, value: undefined };
          },
        };
      },
    };
  }
}

const globalLive = globalThis as typeof globalThis & { __webdocChangeHub?: ChangeHub };
export const changeHub = globalLive.__webdocChangeHub ??= new ChangeHub();
