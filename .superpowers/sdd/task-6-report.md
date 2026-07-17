# Task 6 Report: Live Configuration and Filesystem Refresh

## Status

Implemented live filesystem/config refresh with a process-wide change hub and watcher, SSE delivery, and client refresh/disconnection state.

## Implementation

- Added a bounded `AsyncIterable` change hub with abort and iterator cleanup.
- Added one process-wide Chokidar watcher with 100 ms project/path debounce and relative-only paths.
- Valid configuration reloads reconcile added/removed roots before atomically replacing the active config; invalid reloads preserve the last valid object and publish degraded state.
- Watch errors/overflow initiate at most one concurrent bounded tree rescan, with degraded/connected status events.
- Added SSE streaming with 15-second heartbeat, immediate connection, abort/cancel cleanup, and no initial-scan blocking.
- Added browser `EventSource` refresh behavior for active project/document and configuration events, using native reconnection and a non-blocking disconnected status.

## TDD Evidence

- RED: watcher and integration suites failed because `src/live/change-hub.ts`, `src/live/watcher.ts`, and the events route did not exist.
- GREEN: focused watcher/events suite passed after implementation.
- Regression RED: full suite exposed missing `EventSource` in jsdom; guarded unsupported environments and reran green.

## Verification

- `npm test -- tests/unit/watcher.test.ts tests/integration/events.test.ts && npm run typecheck`
- `npm test`
- `npm run lint` (no errors; one pre-existing `<img>` performance warning in `src/components/document-view.tsx`)
- `git diff --check`

## Self-review

- No filesystem root is included in client-facing events.
- Removed projects are unwatched and no longer resolve to project events.
- Subscriber queues are bounded and both abort and iterator return remove subscriptions.
- Watcher startup is guarded by a `globalThis` runtime promise to survive Next development module reloads without duplicate watchers.
- Repository currently performs uncached tree reads, so bounded recovery rescans the affected configured trees directly; there is no separate cache to invalidate.

## Concerns

- Recovery rescans every configured project because the generic Chokidar error callback does not identify a reliable affected root.
- Native `EventSource` exposes reconnect timing to the browser; the UI deliberately remains usable while disconnected.
