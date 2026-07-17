# Local Multi-Project WebDoc Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Next.js service that safely reads several configured local documentation roots and live-renders Markdown, Mermaid diagrams, images, and attachments.

**Architecture:** A server-only configuration and repository core owns all filesystem access and applies one canonical path policy. Next.js route handlers expose trees, documents, assets, and change events; React client components provide the project switcher, file tree, Markdown view, Mermaid enhancement, and live refresh. Disk content is read on demand, while file trees use an invalidated in-process cache.

**Tech Stack:** Node.js 24, TypeScript 5, Next.js 16.2.10, React 19.2.7, Vitest, Testing Library, Playwright, Zod, YAML, unified/remark/rehype, Shiki, Mermaid 11.16.0, Chokidar.

## Global Constraints

- Listen on `127.0.0.1` by default; binding to `0.0.0.0` must be explicit.
- Project IDs are unique and URL-safe; all project roots are absolute canonical paths.
- Raw HTML in Markdown is disabled.
- Symlinks are usable only when their canonical target stays inside the same project root.
- Markdown files default to a 5 MiB limit; assets default to 25 MiB.
- Inline images are PNG, JPEG, GIF, WebP, AVIF, and SVG; unknown formats download instead of rendering.
- Full-text search, authentication, editing, Git synchronization, and version history are outside this plan.

---

## File Map

- `package.json`, `tsconfig.json`, `next.config.ts`, `vitest.config.ts`, `playwright.config.ts`: toolchain and commands.
- `src/config/schema.ts`, `src/config/load.ts`: configuration types, validation, canonicalization, and reload behavior.
- `src/lib/path-policy.ts`: the single path containment and symlink policy.
- `src/repository/types.ts`, `src/repository/repository.ts`: file trees, homepage choice, metadata, and bounded reads.
- `src/markdown/render.ts`, `src/markdown/links.ts`: server-side Markdown rendering and safe relative URL rewriting.
- `src/live/change-hub.ts`, `src/live/watcher.ts`: debounced project change events and cache invalidation.
- `src/app/api/projects/route.ts`, `src/app/api/tree/[projectId]/route.ts`: project and tree JSON.
- `src/app/api/content/[projectId]/[...path]/route.ts`: Markdown HTML and metadata.
- `src/app/api/assets/[projectId]/[...path]/route.ts`: inline images and attachment downloads.
- `src/app/api/events/route.ts`: server-sent change events.
- `src/app/page.tsx`, `src/app/p/[projectId]/[[...path]]/page.tsx`: root redirect and stable document routes.
- `src/components/*`: shell, selector, tree, Markdown view, Mermaid blocks, and live refresh.
- `tests/fixtures/*`, `tests/unit/*`, `tests/integration/*`, `tests/e2e/*`: isolated filesystem and browser coverage.

---

### Task 1: Toolchain and Validated Configuration

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `next.config.ts`
- Create: `vitest.config.ts`
- Create: `src/config/schema.ts`
- Create: `src/config/load.ts`
- Create: `tests/unit/config.test.ts`
- Create: `webdoc.config.example.yaml`

**Interfaces:**
- Produces: `WebDocConfig`, `ProjectConfig`, `loadConfig(path: string): Promise<WebDocConfig>`.
- `ProjectConfig.root` is an absolute canonical filesystem path used by every later filesystem operation.

- [ ] **Step 1: Add the application and test toolchain**

Create scripts `dev`, `build`, `start`, `test`, `test:watch`, `test:e2e`, `typecheck`, and `lint`. Install Next 16.2.10, React 19.2.7, TypeScript, Zod, YAML, Vitest, jsdom, Testing Library, unified/remark/rehype packages, Shiki, Mermaid 11.16.0, Chokidar, and Playwright.

Run: `npm install`

Expected: `package-lock.json` is generated and `npm ls --depth=0` exits 0.

- [ ] **Step 2: Write failing configuration tests**

```ts
it("canonicalizes project roots and applies server defaults", async () => {
  const config = await loadFixtureConfig(`projects:\n  - id: alpha\n    title: Alpha\n    path: ./alpha\n`);
  expect(config.server).toEqual({ host: "127.0.0.1", port: 3000 });
  expect(config.projects[0].root).toBe(await realpath(fixture("alpha")));
});

it.each(["../bad", "has space", ""])('rejects project id %j', async (id) => {
  await expect(loadFixtureConfig(`projects:\n  - id: ${JSON.stringify(id)}\n    title: Bad\n    path: ./alpha\n`)).rejects.toThrow(/project.*id/i);
});

it("rejects duplicate project ids", async () => {
  await expect(loadFixtureConfig(DUPLICATE_IDS)).rejects.toThrow(/unique/i);
});
```

Run: `npm test -- tests/unit/config.test.ts`

Expected: FAIL because `loadConfig` does not exist.

- [ ] **Step 3: Implement schema validation and loading**

```ts
export type ProjectConfig = {
  id: string;
  title: string;
  root: string;
  homepage?: string;
};

export type WebDocConfig = {
  server: { host: string; port: number };
  limits: { markdownBytes: number; assetBytes: number };
  projects: ProjectConfig[];
};

export async function loadConfig(configPath: string): Promise<WebDocConfig> {
  const source = await readFile(configPath, "utf8");
  const parsed = RawConfigSchema.parse(parseYaml(source));
  assertUniqueIds(parsed.projects);
  const base = dirname(resolve(configPath));
  const projects = await Promise.all(parsed.projects.map(async (project) => ({
    id: project.id,
    title: project.title,
    root: await realpath(resolve(base, project.path)),
    homepage: project.homepage,
  })));
  return {
    server: { host: parsed.server?.host ?? "127.0.0.1", port: parsed.server?.port ?? 3000 },
    limits: { markdownBytes: parsed.limits?.markdownBytes ?? 5 * 1024 * 1024, assetBytes: parsed.limits?.assetBytes ?? 25 * 1024 * 1024 },
    projects,
  };
}
```

Use Zod refinements for `/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/`, non-empty project lists, ports 1–65535, positive limits, and unique IDs. Validate configured homepages through the path policy in Task 2.

- [ ] **Step 4: Verify configuration and toolchain**

Run: `npm test -- tests/unit/config.test.ts && npm run typecheck`

Expected: all configuration tests pass and TypeScript exits 0.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json tsconfig.json next.config.ts vitest.config.ts src/config tests/unit/config.test.ts webdoc.config.example.yaml
git commit -m "feat: add validated webdoc configuration"
```

### Task 2: Canonical Path Policy and Document Repository

**Files:**
- Create: `src/lib/path-policy.ts`
- Create: `src/repository/types.ts`
- Create: `src/repository/repository.ts`
- Create: `tests/unit/path-policy.test.ts`
- Create: `tests/unit/repository.test.ts`

**Interfaces:**
- Consumes: `ProjectConfig`, configured byte limits.
- Produces: `resolveInsideRoot(root: string, requested: string): Promise<string>`.
- Produces: `DocumentRepository.getTree(project): Promise<TreeNode[]>`, `chooseHomepage(project, tree): Promise<string | null>`, `read(project, path, limit): Promise<Buffer>`.

- [ ] **Step 1: Write path attack tests**

```ts
it.each(["../secret", "%2e%2e/secret", "/etc/passwd", "C:\\Windows\\win.ini"])("rejects %s", async (path) => {
  await expect(resolveInsideRoot(root, path)).rejects.toThrow(PathPolicyError);
});

it("rejects a symlink whose canonical target escapes the root", async () => {
  await symlink(outsideFile, join(root, "escape.md"));
  await expect(resolveInsideRoot(root, "escape.md")).rejects.toThrow(/outside/i);
});

it("allows an internal symlink", async () => {
  await symlink(join(root, "guide.md"), join(root, "alias.md"));
  expect(await resolveInsideRoot(root, "alias.md")).toBe(join(root, "guide.md"));
});
```

Run: `npm test -- tests/unit/path-policy.test.ts`

Expected: FAIL because the policy is absent.

- [ ] **Step 2: Implement one canonical containment check**

```ts
export async function resolveInsideRoot(root: string, requested: string): Promise<string> {
  const decoded = decodeURIComponentOnce(requested);
  if (decoded.includes("\0") || isAbsolute(decoded) || /^[A-Za-z]:/.test(decoded)) throw new PathPolicyError("absolute path rejected");
  const lexical = resolve(root, decoded);
  if (!isContained(root, lexical)) throw new PathPolicyError("path outside project root");
  const canonical = await realpath(lexical);
  if (!isContained(root, canonical)) throw new PathPolicyError("symlink target outside project root");
  return canonical;
}
```

`isContained` must compare `relative(root, candidate)` and accept only `""` or a value that is neither `..` nor absolute. Decode exactly once; a second encoded traversal remains a literal filename and cannot escape after joining.

- [ ] **Step 3: Write repository behavior tests**

```ts
it("sorts directories first and entries naturally without case sensitivity", async () => {
  expect(names(await repository.getTree(project))).toEqual(["API", "Guide", "page2.md", "page10.md"]);
});

it.each([
  [{ homepage: "start.md" }, "start.md"],
  [{}, "README.md"],
  [{}, "index.md"],
])("chooses the documented homepage order", async ([override, expected]) => {
  expect(await repository.chooseHomepage({ ...project, ...override })).toBe(expected);
});

it("rejects content larger than the supplied limit before buffering", async () => {
  await expect(repository.read(project, "large.md", 8)).rejects.toThrow(FileTooLargeError);
});
```

Run: `npm test -- tests/unit/repository.test.ts`

Expected: FAIL because repository functions are absent.

- [ ] **Step 4: Implement the repository**

Define discriminated tree nodes:

```ts
export type TreeNode =
  | { kind: "directory"; name: string; path: string; children: TreeNode[] }
  | { kind: "markdown" | "image" | "attachment"; name: string; path: string; size: number };
```

Scan with `opendir`, resolve each entry through `resolveInsideRoot`, omit broken or escaping symlinks, track visited canonical directory paths to break cycles, and use `Intl.Collator(undefined, { numeric: true, sensitivity: "base" })`. Before reading, `stat` the canonical file and reject sizes above the supplied limit.

- [ ] **Step 5: Verify and commit**

Run: `npm test -- tests/unit/path-policy.test.ts tests/unit/repository.test.ts && npm run typecheck`

Expected: all tests pass.

```bash
git add src/lib src/repository tests/unit/path-policy.test.ts tests/unit/repository.test.ts
git commit -m "feat: add safe document repository"
```

### Task 3: Markdown Rendering and Relative Links

**Files:**
- Create: `src/markdown/links.ts`
- Create: `src/markdown/render.ts`
- Create: `tests/unit/markdown.test.ts`

**Interfaces:**
- Consumes: project ID, current document path, Markdown source.
- Produces: `renderMarkdown(input: RenderInput): Promise<{ html: string; title?: string }>`.
- Mermaid blocks produce `<pre class="mermaid" data-mermaid-source="...">` for client enhancement.

- [ ] **Step 1: Write renderer and URL rewriting tests**

```ts
it("renders GFM while dropping raw HTML", async () => {
  const result = await renderMarkdown({ projectId: "alpha", documentPath: "guide/a.md", source: "|A|B|\n|-|-|\n|1|2|\n<script>alert(1)</script>" });
  expect(result.html).toContain("<table>");
  expect(result.html).not.toContain("<script");
});

it("rewrites relative docs and images but preserves external links", async () => {
  const { html } = await renderMarkdown({ projectId: "alpha", documentPath: "guide/a.md", source: "[B](../b.md) ![P](./p.png) [X](https://example.com)" });
  expect(html).toContain('/p/alpha/b.md');
  expect(html).toContain('/api/assets/alpha/guide/p.png');
  expect(html).toContain('target="_blank" rel="noopener noreferrer"');
});

it("marks Mermaid blocks without executing diagram content on the server", async () => {
  expect((await renderMarkdown(MERMAID_INPUT)).html).toContain('class="mermaid"');
});
```

Run: `npm test -- tests/unit/markdown.test.ts`

Expected: FAIL because `renderMarkdown` is absent.

- [ ] **Step 2: Implement the unified pipeline**

Use `remark-parse`, `remark-gfm`, `remark-rehype` without `allowDangerousHtml`, a custom link/image AST transform, `rehype-slug`, `rehype-autolink-headings`, Shiki code rendering, and `rehype-stringify`. Treat `mermaid` fences separately from Shiki. Reject rewritten relative paths that normalize above the document root; the API will enforce canonical containment again before filesystem access.

```ts
export async function renderMarkdown(input: RenderInput) {
  const file = await unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(rewriteRelativeUrls, input)
    .use(remarkRehype)
    .use(rehypeSlug)
    .use(rehypeAutolinkHeadings)
    .use(rehypeShiki, { theme: "github-dark" })
    .use(rehypeStringify)
    .process(input.source);
  return { html: String(file), title: firstHeading(file) };
}
```

- [ ] **Step 3: Verify and commit**

Run: `npm test -- tests/unit/markdown.test.ts && npm run typecheck`

Expected: all tests pass.

```bash
git add src/markdown tests/unit/markdown.test.ts
git commit -m "feat: render safe GFM and Mermaid documents"
```

### Task 4: Project, Tree, Content, and Asset APIs

**Files:**
- Create: `src/server/context.ts`
- Create: `src/http/responses.ts`
- Create: `src/app/api/projects/route.ts`
- Create: `src/app/api/tree/[projectId]/route.ts`
- Create: `src/app/api/content/[projectId]/[...path]/route.ts`
- Create: `src/app/api/assets/[projectId]/[...path]/route.ts`
- Create: `tests/integration/api.test.ts`

**Interfaces:**
- Consumes: `loadConfig`, `DocumentRepository`, and `renderMarkdown`.
- Produces JSON project/tree/content endpoints and streamed asset responses.
- `getServerContext()` returns the last valid config and repository singleton.

- [ ] **Step 1: Write API integration tests against temporary projects**

```ts
it("lists projects without exposing filesystem roots", async () => {
  const response = await GET_PROJECTS();
  expect(await response.json()).toEqual({ projects: [{ id: "alpha", title: "Alpha", available: true }] });
});

it("returns rendered document HTML", async () => {
  const response = await GET_CONTENT(params("alpha", ["README.md"]));
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ path: "README.md", html: expect.stringContaining("<h1") });
});

it("serves SVG as an image with hardened headers", async () => {
  const response = await GET_ASSET(params("alpha", ["diagram.svg"]));
  expect(response.headers.get("content-type")).toBe("image/svg+xml");
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  expect(response.headers.get("content-security-policy")).toContain("script-src 'none'");
});
```

Also cover unknown project 404, traversal 400, missing file 404, unreadable file 403, oversized file 413, unsupported attachment `Content-Disposition: attachment`, and an unavailable project 503.

Run: `npm test -- tests/integration/api.test.ts`

Expected: FAIL because route handlers are absent.

- [ ] **Step 2: Implement the server context and response mapping**

```ts
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
  return { config, repository: new DocumentRepository(config.limits) };
}
```

Map `PathPolicyError` to 400, missing paths to 404, permission errors to 403, `FileTooLargeError` to 413, unavailable roots to 503, and unexpected failures to a logged 500 without exposing absolute paths.

- [ ] **Step 3: Implement route handlers**

Each handler resolves `params` exactly once, finds the configured project by ID, and delegates all filesystem operations to the repository. Stream assets from the canonical file rather than buffering them. Set explicit MIME types, `nosniff`, cache validators from `mtime` and size, and safe content disposition. Project JSON must never include `root`.

- [ ] **Step 4: Verify and commit**

Run: `npm test -- tests/integration/api.test.ts && npm run typecheck`

Expected: all API tests pass.

```bash
git add src/server src/http src/app/api tests/integration/api.test.ts
git commit -m "feat: expose safe document and asset APIs"
```

### Task 5: Stable Routes and Two-Column Reader UI

**Files:**
- Create: `src/app/layout.tsx`
- Create: `src/app/globals.css`
- Create: `src/app/page.tsx`
- Create: `src/app/p/[projectId]/[[...path]]/page.tsx`
- Create: `src/components/app-shell.tsx`
- Create: `src/components/project-switcher.tsx`
- Create: `src/components/file-tree.tsx`
- Create: `src/components/document-view.tsx`
- Create: `src/components/mermaid-blocks.tsx`
- Create: `tests/unit/components.test.tsx`

**Interfaces:**
- Consumes: server context, repository trees, and rendered content.
- Produces stable `/p/:projectId/:path*` pages with responsive desktop sidebar/mobile drawer.

- [ ] **Step 1: Write component behavior tests**

```tsx
it("switches projects to their homepages", async () => {
  render(<ProjectSwitcher projects={PROJECTS} activeId="alpha" />);
  await userEvent.selectOptions(screen.getByLabelText("Project"), "beta");
  expect(mockPush).toHaveBeenCalledWith("/p/beta/README.md");
});

it("renders directories and document links in the tree", () => {
  render(<FileTree projectId="alpha" nodes={TREE} activePath="guide/a.md" />);
  expect(screen.getByRole("link", { name: "a.md" })).toHaveAttribute("href", "/p/alpha/guide/a.md");
});

it("shows Mermaid source when rendering fails", async () => {
  mockMermaidRender.mockRejectedValue(new Error("bad diagram"));
  render(<MermaidBlocks html={'<pre class="mermaid">broken</pre>'} />);
  expect(await screen.findByText(/diagram could not be rendered/i)).toBeVisible();
  expect(screen.getByText("broken")).toBeVisible();
});
```

Run: `npm test -- tests/unit/components.test.tsx`

Expected: FAIL because components are absent.

- [ ] **Step 2: Implement server routes and root redirect**

`/` loads the first project and redirects to its chosen homepage. `/p/[projectId]/[[...path]]` validates the project and path, selects the project homepage when the path is absent or denotes a directory, and returns `notFound()` for missing content. A project with no Markdown shows its tree and an empty state.

- [ ] **Step 3: Implement the accessible reader shell**

Build a sticky header with a labeled project `<select>`, a left `<nav aria-label="Document tree">`, and a `<main>` content pane. Use nested lists and real links for the tree. At widths below 768px, hide the sidebar behind a button with `aria-expanded` and a focus-managed drawer. Preserve document width and allow large tables/code blocks to scroll horizontally.

- [ ] **Step 4: Enhance Mermaid blocks on the client**

```tsx
useEffect(() => {
  mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: "neutral" });
  for (const [index, node] of [...container.querySelectorAll("pre.mermaid")].entries()) {
    renderDiagram(node, `mermaid-${stableHash(path)}-${index}`);
  }
}, [html, path]);
```

Insert returned SVG only into the dedicated Mermaid container. On failure, keep escaped source and add a localized error message.

- [ ] **Step 5: Verify and commit**

Run: `npm test -- tests/unit/components.test.tsx && npm run typecheck && npm run build`

Expected: tests pass and Next.js production build succeeds.

```bash
git add src/app src/components tests/unit/components.test.tsx
git commit -m "feat: add responsive multi-project document reader"
```

### Task 6: Live Configuration and Filesystem Refresh

**Files:**
- Create: `src/live/change-hub.ts`
- Create: `src/live/watcher.ts`
- Create: `src/app/api/events/route.ts`
- Create: `src/components/live-refresh.tsx`
- Modify: `src/server/context.ts`
- Modify: `src/components/app-shell.tsx`
- Create: `tests/unit/watcher.test.ts`
- Create: `tests/integration/events.test.ts`

**Interfaces:**
- Produces: `ChangeEvent = { kind: "project" | "config" | "status"; projectId?: string; path?: string; status?: "connected" | "degraded" }`.
- Produces: `ChangeHub.subscribe(signal): AsyncIterable<ChangeEvent>` and `ProjectWatcher.start(config): Promise<void>`.

- [ ] **Step 1: Write watcher and reload tests**

```ts
it("debounces a burst into one project-scoped event", async () => {
  emitFs("change", join(alphaRoot, "guide.md"));
  emitFs("change", join(alphaRoot, "guide.md"));
  await vi.advanceTimersByTimeAsync(100);
  expect(hub.publish).toHaveBeenCalledTimes(1);
  expect(hub.publish).toHaveBeenCalledWith({ kind: "project", projectId: "alpha", path: "guide.md" });
});

it("retains the last valid config when reload validation fails", async () => {
  await watcher.reloadConfig(INVALID_YAML);
  expect(context.config).toBe(previousConfig);
  expect(hub.publish).toHaveBeenCalledWith(expect.objectContaining({ kind: "status", status: "degraded" }));
});
```

Run: `npm test -- tests/unit/watcher.test.ts tests/integration/events.test.ts`

Expected: FAIL because watcher and event route are absent.

- [ ] **Step 2: Implement the hub, watcher, and cache invalidation**

Use Chokidar with a 100 ms debounce keyed by project and path. On valid config reload, replace the context atomically and reconcile watched roots. On invalid reload, retain the prior context and publish a degraded status. On watcher error or overflow, clear the affected tree cache, perform one bounded rescan, and expose degraded status until successful.

- [ ] **Step 3: Implement SSE and browser refresh**

Return `text/event-stream` with heartbeat comments every 15 seconds and abort cleanup. `LiveRefresh` opens `EventSource('/api/events')`; active-document changes call `router.refresh()`, any active-project change refreshes the tree, and config changes refresh the whole shell. Browser reconnection uses native backoff and shows a non-blocking “live refresh disconnected” status.

- [ ] **Step 4: Verify and commit**

Run: `npm test -- tests/unit/watcher.test.ts tests/integration/events.test.ts && npm run typecheck`

Expected: all watcher and event tests pass with no open-handle warning.

```bash
git add src/live src/app/api/events src/components/live-refresh.tsx src/components/app-shell.tsx src/server/context.ts tests/unit/watcher.test.ts tests/integration/events.test.ts
git commit -m "feat: refresh documents from filesystem changes"
```

### Task 7: Security Headers, Error Views, and End-to-End Acceptance

**Files:**
- Modify: `next.config.ts`
- Create: `src/app/not-found.tsx`
- Create: `src/app/error.tsx`
- Create: `src/components/project-unavailable.tsx`
- Create: `playwright.config.ts`
- Create: `tests/e2e/webdoc.spec.ts`
- Create: `tests/fixtures/project-alpha/README.md`
- Create: `tests/fixtures/project-alpha/guide/links.md`
- Create: `tests/fixtures/project-alpha/images/diagram.svg`
- Create: `tests/fixtures/project-beta/index.md`
- Create: `README.md`

**Interfaces:**
- Consumes all previous tasks.
- Produces hardened application responses, user-facing failure states, executable setup documentation, and release acceptance tests.

- [ ] **Step 1: Write browser acceptance tests**

```ts
test("browses two projects and restores a deep link", async ({ page }) => {
  await page.goto("/p/project-alpha/guide/links.md");
  await expect(page.getByRole("heading", { name: "Links" })).toBeVisible();
  await page.getByLabel("Project").selectOption("project-beta");
  await expect(page).toHaveURL(/\/p\/project-beta\/index\.md$/);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Beta" })).toBeVisible();
});

test("renders an image and Mermaid, then live-refreshes an edited document", async ({ page }) => {
  await page.goto("/p/project-alpha/README.md");
  await expect(page.getByRole("img", { name: "Diagram" })).toBeVisible();
  await expect(page.locator(".mermaid svg")).toBeVisible();
  await updateFixtureReadme("Changed heading");
  await expect(page.getByRole("heading", { name: "Changed heading" })).toBeVisible();
});
```

Also test the mobile drawer at 390×844, raw HTML removal, external-link attributes, a missing document 404, unavailable project UI, oversized Markdown error, and traversal API rejection.

Run: `npm run test:e2e`

Expected: FAIL until final headers, views, fixtures, and documentation are complete.

- [ ] **Step 2: Add global security headers and failure views**

Configure headers for all routes: `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY`, and a Content Security Policy that permits same-origin assets, the minimum styles needed by Shiki, and no objects. Mermaid must not require `unsafe-eval`. Add scoped 404, unexpected-error, unavailable-project, and live-refresh-degraded views without printing absolute paths or stacks.

- [ ] **Step 3: Document setup and operation**

README must include:

```bash
cp webdoc.config.example.yaml webdoc.config.yaml
npm install
npm run dev
```

Document YAML fields, homepage precedence, supported formats, 5 MiB/25 MiB defaults, `WEBDOC_CONFIG`, localhost default, explicit internal-network binding risks, reverse-proxy recommendation, production `npm run build && npm start`, and troubleshooting for missing/unreadable directories and watcher degradation.

- [ ] **Step 4: Run the complete release gate**

Run: `npm test && npm run typecheck && npm run lint && npm run build && npm run test:e2e`

Expected: every command exits 0; production build contains `/`, `/p/[projectId]/[[...path]]`, and all four API groups; Playwright reports all acceptance tests passed.

- [ ] **Step 5: Commit**

```bash
git add next.config.ts src/app/not-found.tsx src/app/error.tsx src/components/project-unavailable.tsx playwright.config.ts tests/e2e tests/fixtures README.md
git commit -m "test: verify secure multi-project webdoc workflow"
```

### Task 8: Final Spec Trace and Clean Verification

**Files:**
- Modify only files found defective by the commands below.

**Interfaces:**
- Consumes the entire application.
- Produces a clean, reproducible release candidate matching the approved design.

- [ ] **Step 1: Verify every design requirement has an automated or documented check**

Run:

```bash
rg -n "project|homepage|GFM|Mermaid|relative|SVG|symlink|traversal|5 MiB|25 MiB|127.0.0.1|live refresh" README.md tests src
```

Expected: each term maps to implementation plus at least one test or an explicit operational statement.

- [ ] **Step 2: Run from a clean dependency state**

Run: `rm -rf node_modules .next && npm ci && npm test && npm run typecheck && npm run lint && npm run build && npm run test:e2e`

Expected: clean install and every verification command exit 0.

- [ ] **Step 3: Inspect repository state and commit only necessary corrections**

Run: `git status --short && git diff --check`

Expected: no generated build output is tracked, no whitespace errors exist, and only intentional corrections remain.

If corrections were required:

```bash
git add -u
git commit -m "fix: close webdoc acceptance gaps"
```

If no corrections were required, do not create an empty commit.
