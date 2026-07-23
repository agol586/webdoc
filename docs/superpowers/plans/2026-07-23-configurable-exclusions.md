# Configurable Project Exclusions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-project glob exclusions that remove matching files and directories from DocShare and block direct access to them.

**Architecture:** Validate an optional `projects[].exclude` array into `ProjectConfig`, then centralize portable glob and ancestor matching in `src/lib/exclusions.ts` using Node.js `path.matchesGlob()`. Enforce the policy inside `DocumentRepository` for scans, homepages, buffered reads, and streamed reads so every page and API entry point inherits the same behavior.

**Tech Stack:** TypeScript, Node.js 24 `node:path`, Zod, Vitest, Next.js route handlers, YAML.

## Global Constraints

- Do not add dependencies.
- Glob patterns are case-sensitive and match project-root-relative paths with `/` separators.
- Directories are matched both as `path` and `path/`; an excluded ancestor excludes all descendants.
- Exclusions apply to tree scans, homepages, Markdown reads, and asset streams.
- Projects without `exclude` retain existing behavior.
- Explicit homepages that are excluded must fail configuration loading.

---

### Task 1: Configuration and exclusion policy

**Files:**
- Create: `src/lib/exclusions.ts`
- Modify: `src/config/schema.ts`
- Modify: `src/config/load.ts`
- Test: `tests/unit/config.test.ts`
- Create test: `tests/unit/exclusions.test.ts`

**Interfaces:**
- Produces: `ProjectConfig.exclude: string[]`
- Produces: `isExcludedPath(patterns: readonly string[], relativePath: string, options?: { directory?: boolean }): boolean`
- Produces: `isExcludedTarget(root: string, patterns: readonly string[], requestedPath: string, canonicalPath: string, options?: { directory?: boolean }): boolean`

- [ ] **Step 1: Write failing configuration tests**

Add assertions that absent exclusions default to `[]`, glob arrays are retained, empty patterns are rejected, and an explicit homepage matching `exclude` is rejected:

```ts
expect(config.projects[0].exclude).toEqual([]);

expect(
  (await loadFixtureConfig(
    "projects:\n  - id: alpha\n    title: Alpha\n    path: ./alpha\n    exclude:\n      - '**/*.draft.md'\n      - private\n",
  )).config.projects[0].exclude,
).toEqual(["**/*.draft.md", "private"]);

await expect(loadFixtureConfig(
  "projects:\n  - id: alpha\n    title: Alpha\n    path: ./alpha\n    exclude:\n      - ''\n",
)).rejects.toThrow(/exclude/i);
```

Create a real `README.md`, configure it as both `homepage` and an excluded path, and expect `loadConfig()` to reject with `/homepage.*excluded/i`.

- [ ] **Step 2: Write failing exclusion matcher tests**

Create `tests/unit/exclusions.test.ts` with cases proving:

```ts
expect(isExcludedPath(["**/*.draft.md"], "guide/start.draft.md")).toBe(true);
expect(isExcludedPath(["**/node_modules/**"], "pkg/node_modules", { directory: true })).toBe(true);
expect(isExcludedPath(["private"], "private/secret.md")).toBe(true);
expect(isExcludedPath(["PRIVATE"], "private/secret.md")).toBe(false);
expect(isExcludedPath(["docs/*.md"], "docs\\guide.md")).toBe(process.platform === "win32");
```

Use a temporary root and `isExcludedTarget()` to prove that either an encoded requested path or a canonical target path can trigger exclusion.

- [ ] **Step 3: Run tests and verify RED**

Run:

```bash
npx vitest run tests/unit/config.test.ts tests/unit/exclusions.test.ts
```

Expected: failure because `exclude`, `isExcludedPath()`, and `isExcludedTarget()` do not exist.

- [ ] **Step 4: Implement the minimal policy and configuration**

In `src/config/schema.ts`, add:

```ts
exclude: z.array(z.string().min(1, "Exclude pattern must not be empty")).optional(),
```

In `src/lib/exclusions.ts`, use `matchesGlob`, `relative`, and `sep` from `node:path`. Normalize OS separators to `/`, test the full path, test `path/` for directories, and walk parent segments so an exact excluded directory excludes descendants. `isExcludedTarget()` must decode the already-validated requested path once and check both that logical path and `relative(root, canonicalPath)`.

In `src/config/load.ts`, add `exclude: string[]` to `ProjectConfig`, default it to `[]`, validate an explicit homepage as an existing Markdown file, resolve its canonical path, and reject it when `isExcludedTarget()` returns true.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run:

```bash
npx vitest run tests/unit/config.test.ts tests/unit/exclusions.test.ts
```

Expected: all tests pass.

### Task 2: Repository enforcement

**Files:**
- Modify: `src/repository/repository.ts`
- Test: `tests/unit/repository.test.ts`

**Interfaces:**
- Consumes: `ProjectConfig.exclude`
- Consumes: `isExcludedPath()` and `isExcludedTarget()`
- Preserves: public `DocumentRepository` method signatures

- [ ] **Step 1: Write failing tree and homepage tests**

Add repository tests that create:

```text
README.md
guide/public.md
guide/hidden.draft.md
private/secret.md
pkg/node_modules/dependency.md
```

Configure:

```ts
project = {
  id: "docs",
  title: "Docs",
  root,
  exclude: ["**/*.draft.md", "private", "**/node_modules/**", "README.md"],
};
```

Assert the tree omits all excluded entries, including the entire `private` and `node_modules` directory nodes. Assert automatic homepage selection skips excluded `README.md` and selects `guide/public.md`.

- [ ] **Step 2: Write failing direct-access tests**

Assert `read()` rejects excluded Markdown and `stream()` rejects excluded assets with `{ code: "EACCES" }`. Add an internal symlink whose alias is allowed but whose canonical target matches an exclusion, then assert reading the alias is rejected.

- [ ] **Step 3: Run repository tests and verify RED**

Run:

```bash
npx vitest run tests/unit/repository.test.ts
```

Expected: excluded entries remain visible/readable.

- [ ] **Step 4: Implement minimal repository enforcement**

Add an `EACCES` exclusion error helper. During `scanDirectory()`, resolve and stat each entry, then skip it before recursion/node creation when either its logical relative path or canonical root-relative path is excluded. Pass directory metadata so trailing-slash patterns prune directories.

Before opening a file in `read()` and `stream()`, resolve it and reject it when `isExcludedTarget()` matches. Update homepage validation and no-tree fallback to reject or skip excluded paths; tree-based fallback already receives a filtered tree.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run:

```bash
npx vitest run tests/unit/repository.test.ts tests/unit/config.test.ts tests/unit/exclusions.test.ts
```

Expected: all tests pass.

### Task 3: End-to-end API behavior and documentation

**Files:**
- Modify: `tests/integration/api.test.ts`
- Modify: `docshare.config.example.yaml`
- Modify: `README.md`

**Interfaces:**
- Consumes: existing API route behavior backed by `DocumentRepository`
- Produces: documented `projects[].exclude` configuration

- [ ] **Step 1: Write failing API tests**

In the API fixture, create excluded Markdown, asset, and directory content, then configure:

```yaml
exclude:
  - "**/*.excluded.md"
  - "private"
```

Assert the tree response contains none of their paths. Assert direct content and asset requests return `403` with exactly `{ "error": "Forbidden" }`.

- [ ] **Step 2: Run API tests and verify RED**

Run:

```bash
npx vitest run tests/integration/api.test.ts
```

Expected before repository enforcement: excluded entries are returned or served. If Task 2 already makes the new tests pass, retain the tests as the cross-route regression proof and proceed.

- [ ] **Step 3: Update public configuration documentation**

Add representative exclusions to `docshare.config.example.yaml` and the README configuration example. Document that patterns are per-project, case-sensitive, project-relative globs; exact directory matches exclude descendants; `**/directory/**` prunes matching directories; and an excluded explicit homepage is invalid.

- [ ] **Step 4: Run complete verification**

Run:

```bash
npm test
npm run typecheck
npm run lint
npm run build
git diff --check
```

Expected: every command exits successfully with no new warnings or formatting errors.
