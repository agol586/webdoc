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

## Review Changes

### RED

- Added HMR/config-path identity coverage proving reloaded modules share the exact context and a path change closes the prior watcher.
- Added health snapshot tests proving degraded state is replayed to late subscribers.
- Added a 150-event slow-subscriber test proving bounded queues preserve config and current status.
- Added watcher tests for removed-root timer cancellation, root directory events, single recovery execution, and maximum rescan concurrency of one.
- The focused run failed in all newly covered old behaviors: missing health replay, stale timer publication, missing root event, parallel rescans, and absent shared runtime context.

### GREEN

- Moved context and runtime promises into one process-global holder keyed by absolute config path; new-path runtime startup waits for the old watcher to close.
- Persisted health in `ChangeHub`, initialized connected, updated it on status publication, and queued the current snapshot for every subscriber/SSE stream.
- Changed bounded queues to coalesce project/path, config, and status events and preferentially evict project events.
- Reconciliation now clears timers for removed or remapped projects, and each callback revalidates its project/root mapping before publishing.
- Root add/remove events publish a project-wide event without a path.
- Recovery now uses one active loop with sequential project scans and exposes `ProjectWatcher.close()` for lifecycle cleanup.

### Review Verification

- Focused: 3 files, 11 tests passed.
- Full: 11 files, 111 tests passed.
- Typecheck passed.
- Lint completed with zero errors and the same pre-existing `<img>` warning.

## Lifecycle Review v2

### RED

- Added close-during-reload and close-during-recovery tests; the prior watcher could publish or replace context after shutdown and did not await tracked work.
- Added overlapping reload coverage with controlled loader completion; the prior implementation had no loader single-flight/version mechanism.
- Added A→B→A holder coverage; the intermediate runtime previously started after it had already been superseded.
- Added health-reset coverage; a newly started current runtime previously left the hub degraded.
- Added repository abort and entry-budget tests; the previous recursive scan ignored both options.
- Added recovery project/entry budget assertions and verified sequential concurrency remains one.

### GREEN

- `ProjectWatcher` now owns a closed flag, generation token, tracked in-flight set, recovery abort controller, and serialized dirty-version reload loop. All post-await mutations/publications require the current generation.
- `close()` invalidates the generation first, clears timers, aborts recovery, closes Chokidar, and awaits all entered reload/recovery work.
- Holder teardown chains the predecessor teardown and runtime close. Superseded holders cannot start; only the current successfully started runtime publishes connected health.
- `DocumentRepository.getTree` accepts backward-compatible optional `{ signal, maxEntries }`, checking abort/budget throughout recursive traversal.
- Recovery scans at most 100 projects, at most 100,000 entries per project, sequentially, with a 30-second abort deadline. Budget/deadline failure leaves health degraded and stops the scan.

### Lifecycle v2 Verification

- Focused watcher/events/repository/context: 4 files, 38 tests passed.
- Full: 11 files, 119 tests passed.
- Typecheck passed.
- Lint completed with zero errors and the same pre-existing `<img>` warning.
