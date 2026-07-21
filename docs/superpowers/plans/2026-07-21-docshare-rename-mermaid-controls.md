# DocShare Rename and Mermaid Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Completely rename the active WebDoc application to DocShare and add accessible zoom, reset, wheel, and drag controls to rendered Mermaid diagrams.

**Architecture:** Rename active identifiers and files without compatibility aliases, while leaving historical `docs/superpowers` records unchanged. Isolate diagram geometry and interaction in a small `mermaid-viewport` module, then let `MermaidBlocks` create an accessible toolbar and bind each successful Mermaid SVG to its own viewport controller.

**Tech Stack:** Next.js 16, React 19, TypeScript, Mermaid 11, Vitest, Testing Library, Playwright, CSS.

## Global Constraints

- Active product names are `DocShare` / `docshare`; old active command, configuration, environment-variable, type, and runtime-global aliases are removed.
- Historical records under `docs/superpowers/` retain their original wording.
- No new runtime or development dependency.
- Diagram state is not persisted across navigation or refresh.
- Touch pinch-to-zoom is out of scope.
- All behavior changes use test-first development.

---

### Task 1: Complete DocShare Rename

**Files:**
- Rename: `scripts/webdoc-server.ts` → `scripts/docshare-server.ts`
- Rename: `scripts/webdoc-server-args.ts` → `scripts/docshare-server-args.ts`
- Rename: `scripts/start-webdoc.sh` → `scripts/start-docshare.sh`
- Rename: `webdoc.config.example.yaml` → `docshare.config.example.yaml`
- Rename: `webdoc.config.yaml` → `docshare.config.yaml`
- Rename: `tests/fixtures/webdoc.config.yaml` → `tests/fixtures/docshare.config.yaml`
- Rename: `tests/e2e/webdoc.spec.ts` → `tests/e2e/docshare.spec.ts`
- Modify: `package.json`, `package-lock.json`, `README.md`, `playwright.config.ts`, `src/app/layout.tsx`, `src/config/load.ts`, `src/live/watcher.ts`, `src/server/context.ts`, `src/live/change-hub.ts`, relevant tests and fixtures.
- Test: `tests/unit/config.test.ts`, `tests/unit/server-launcher.test.ts`, `tests/unit/context-live.test.ts`, `tests/unit/watcher.test.ts`, `tests/integration/api.test.ts`.

**Interfaces:**
- Produces: `DocShareConfig`, `DOCSHARE_CONFIG`, default `docshare.config.yaml`, `scripts/docshare-server.ts`, and DocShare-branded active surfaces.

- [ ] **Step 1: Change rename assertions before production files**

Update tests to import `scripts/docshare-server-args`, execute `scripts/docshare-server.ts`, expect `Usage: docshare-server <dev|start>`, expect package scripts such as `tsx scripts/docshare-server.ts dev`, use `docshare.config.yaml`, set `DOCSHARE_CONFIG`, and refer to `DocShareConfig` and `__docshare...` runtime globals. Rename E2E and fixture configuration paths in test configuration.

- [ ] **Step 2: Verify the rename tests fail for the missing names**

Run: `npm test -- tests/unit/config.test.ts tests/unit/server-launcher.test.ts tests/unit/context-live.test.ts tests/unit/watcher.test.ts tests/integration/api.test.ts`

Expected: FAIL because DocShare launcher modules, paths, and identifiers do not exist yet.

- [ ] **Step 3: Apply the complete active rename**

Use `git mv` for the named files. Change the package name to `docshare`; scripts to:

```json
{
  "dev": "tsx scripts/docshare-server.ts dev",
  "start": "tsx scripts/docshare-server.ts start",
  "boot": "bash scripts/start-docshare.sh"
}
```

Change the launcher and server context default to:

```ts
resolve(process.env.DOCSHARE_CONFIG ?? resolve(process.cwd(), "docshare.config.yaml"))
```

Rename `WebDocConfig` to `DocShareConfig`, runtime globals to `__docshareServerHolder` and `__docshareChangeHub`, and active log/product strings to DocShare. Update current README commands and examples, metadata, fixture content, temp-directory prefixes, test descriptions, and Playwright configuration.

- [ ] **Step 4: Verify targeted rename tests pass and scan active files**

Run:

```bash
npm test -- tests/unit/config.test.ts tests/unit/server-launcher.test.ts tests/unit/context-live.test.ts tests/unit/watcher.test.ts tests/integration/api.test.ts
rg -n "webdoc|WebDoc|WEBDOC" package.json package-lock.json README.md playwright.config.ts scripts src tests docshare.config.yaml docshare.config.example.yaml
```

Expected: tests PASS; the scan returns no active old-name references.

### Task 2: ViewBox Geometry Controller

**Files:**
- Create: `src/components/mermaid-viewport.ts`
- Create: `tests/unit/mermaid-viewport.test.ts`

**Interfaces:**
- Produces: `parseViewBox(svg: SVGSVGElement): ViewBox`, `zoomViewBox(viewBox: ViewBox, factor: number): ViewBox`, and `panViewBox(viewBox: ViewBox, dxPixels: number, dyPixels: number, widthPixels: number, heightPixels: number): ViewBox`.
- `ViewBox` is `{ x: number; y: number; width: number; height: number }`.

- [ ] **Step 1: Write failing geometry tests**

Cover parsing an explicit `viewBox`, deriving a fallback from numeric width/height, zooming around the center, and translating diagram coordinates based on viewport pixels. Example assertion:

```ts
expect(zoomViewBox({ x: 0, y: 0, width: 100, height: 50 }, 0.8))
  .toEqual({ x: 10, y: 5, width: 80, height: 40 });
```

- [ ] **Step 2: Verify the geometry tests fail**

Run: `npm test -- tests/unit/mermaid-viewport.test.ts`

Expected: FAIL because `src/components/mermaid-viewport.ts` does not exist.

- [ ] **Step 3: Implement minimal pure geometry helpers**

Parse four finite positive `viewBox` values, fall back to positive numeric SVG dimensions, and otherwise use a safe `0 0 100 100` box. Zoom by changing width/height and compensating x/y by half the delta. Pan by converting pixel deltas into current viewBox units and subtracting them from x/y.

- [ ] **Step 4: Verify geometry tests pass**

Run: `npm test -- tests/unit/mermaid-viewport.test.ts`

Expected: PASS.

### Task 3: Accessible Mermaid Controls and Interaction

**Files:**
- Modify: `src/components/mermaid-blocks.tsx`
- Modify: `src/app/globals.css`
- Test: `tests/unit/components.test.tsx`

**Interfaces:**
- Consumes: geometry helpers from `src/components/mermaid-viewport.ts`.
- Produces: per-diagram buttons named `Zoom in`, `Zoom out`, `Reset view`, and `Pan diagram`; wheel zoom; pointer-based pan while pan mode is pressed.

- [ ] **Step 1: Write failing control tests**

Return a mock SVG with `viewBox="0 0 100 50"`. Assert four buttons appear after a successful render, none appear after a failed render, zoom changes the SVG viewBox to `10 5 80 40`, reset restores `0 0 100 50`, and the pan button toggles `aria-pressed`.

- [ ] **Step 2: Verify control tests fail**

Run: `npm test -- tests/unit/components.test.tsx`

Expected: FAIL because Mermaid diagrams have no toolbar or interaction behavior.

- [ ] **Step 3: Implement the toolbar and controller binding**

After successful render, wrap the SVG in `.mermaid-viewport`, add `.mermaid-toolbar` with four `type="button"` controls and inline SVG icons, set accessible labels/titles, and update the SVG `viewBox` for button, wheel, and pointer gestures. Clamp zoom to a practical range relative to the original viewBox and register all listener removals in effect cleanup.

- [ ] **Step 4: Add interaction styling**

Style the Mermaid block as a positioned surface, place the compact toolbar at its upper-right edge, provide hover/focus/pressed states, clip the viewport, and set `grab`/`grabbing` cursors only in pan mode. Preserve responsive layout and existing render-error styling.

- [ ] **Step 5: Verify component and geometry tests pass**

Run: `npm test -- tests/unit/components.test.tsx tests/unit/mermaid-viewport.test.ts`

Expected: PASS.

### Task 4: End-to-End Acceptance and Full Verification

**Files:**
- Modify: `tests/e2e/docshare.spec.ts`
- Modify: `README.md`

**Interfaces:**
- Consumes: renamed launch surface and Mermaid controls.
- Produces: browser-level evidence that two diagrams render with controls and that zoom/reset works.

- [ ] **Step 1: Write failing E2E assertions**

In the Mermaid scenario, assert two `Zoom in` buttons are visible, click the first, verify its SVG `viewBox` changes, click its `Reset view` button, and verify the original `viewBox` is restored.

- [ ] **Step 2: Run the focused E2E scenario**

Run: `npm run test:e2e -- --grep "renders image, Mermaid"`

Expected before completed integration: FAIL on missing controls; after integration: PASS.

- [ ] **Step 3: Document diagram controls**

Add a concise README section explaining toolbar zoom, reset, pan mode, drag, and wheel zoom with the new DocShare name and commands.

- [ ] **Step 4: Run the complete validation suite**

Run:

```bash
npm test
npm run typecheck
npm run lint
npm run build
npm run test:e2e
git diff --check
```

Expected: every command exits successfully, with no active old-name references outside historical records.

