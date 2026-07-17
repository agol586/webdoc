"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import type { ChangeEvent } from "../live/change-hub";

export function LiveRefresh({ activeId, activePath }: { activeId: string; activePath?: string }) {
  const router = useRouter();
  const [disconnected, setDisconnected] = useState(false);
  useEffect(() => {
    if (typeof EventSource === "undefined") return;
    const source = new EventSource("/api/events");
    source.onmessage = (message) => {
      let event: ChangeEvent;
      try { event = JSON.parse(message.data) as ChangeEvent; } catch { return; }
      if (event.kind === "status") setDisconnected(event.status === "degraded");
      if (event.kind === "config" || (event.kind === "project" && event.projectId === activeId)) {
        // A server-component refresh updates the active document, project tree, and shell config.
        if (event.kind === "config" || !event.path || event.path === activePath || event.projectId === activeId) router.refresh();
      }
    };
    source.onerror = () => setDisconnected(true);
    source.onopen = () => setDisconnected(false);
    return () => source.close();
  }, [activeId, activePath, router]);
  return disconnected ? <p role="status" className="live-refresh-status">Live refresh disconnected</p> : null;
}
