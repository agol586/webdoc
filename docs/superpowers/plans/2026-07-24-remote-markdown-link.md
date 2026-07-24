# Remote Markdown Link Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render a public HTTPS Markdown document supplied through `/?link=...` while preventing SSRF and bounded-resource attacks.

**Architecture:** Add an isolated public-address policy and an SSRF-safe HTTPS loader whose resolver and transport are injectable for deterministic tests. Extend the existing Markdown URL rewriting boundary for remote base URLs, then add a small root-page branch that renders the fetched document.

**Tech Stack:** TypeScript, Node.js DNS/HTTPS APIs, Next.js App Router, unified/remark, Vitest.

## Global Constraints

- No new dependencies.
- Only public HTTPS targets are allowed.
- Validate and pin DNS results on every redirect.
- Use the configured Markdown byte limit and a ten-second deadline.
- Preserve existing local-project behavior and CSP.

---

### Task 1: Public network address policy

**Files:**
- Create: `src/remote/public-address.ts`
- Test: `tests/unit/public-address.test.ts`

**Interfaces:**
- Produces: `isPublicAddress(address: string): boolean`.

- [ ] Write table-driven failing tests for public IPv4/IPv6 and private, loopback, link-local, mapped, documentation, multicast, and reserved ranges.
- [ ] Run `npm test -- tests/unit/public-address.test.ts` and confirm the module-not-found failure.
- [ ] Implement literal parsing and CIDR/range checks with Node's `isIP`.
- [ ] Run the focused test and confirm it passes.

### Task 2: SSRF-safe bounded Markdown loader

**Files:**
- Create: `src/remote/fetch-markdown.ts`
- Test: `tests/unit/fetch-markdown.test.ts`

**Interfaces:**
- Produces: `fetchRemoteMarkdown(rawUrl, { maxBytes }, dependencies?)`, returning `{ source, finalUrl }`.
- Produces: `RemoteMarkdownError`.
- Consumes: `isPublicAddress`.

- [ ] Write failing tests for HTTPS-only parsing, credentials, mixed public/private DNS answers, pinned addresses, redirects, redirect limits, response status/content type, byte limits, and timeout-safe errors.
- [ ] Run `npm test -- tests/unit/fetch-markdown.test.ts` and confirm failure because the loader is absent.
- [ ] Implement URL validation, lookup validation, injectable per-hop transport, three-hop redirects, and bounded UTF-8 streaming.
- [ ] Implement the production HTTPS transport with a custom `lookup` callback that returns only the validated address.
- [ ] Run the focused tests and confirm they pass.

### Task 3: Remote Markdown URL semantics

**Files:**
- Modify: `src/markdown/links.ts`
- Modify: `src/markdown/render.ts`
- Modify: `tests/unit/markdown.test.ts`

**Interfaces:**
- Extend `RenderInput` with an optional `remoteBaseUrl`.
- Produce remote relative links resolved against that URL while retaining scheme filtering and safe external-anchor attributes.

- [ ] Add failing tests for relative remote links, fragment links, `mailto:`, and encoded/dangerous schemes.
- [ ] Run `npm test -- tests/unit/markdown.test.ts` and confirm the new assertions fail.
- [ ] Add a focused `rewriteRemoteUrls` plugin and select it in `renderMarkdown` when `remoteBaseUrl` is supplied.
- [ ] Run Markdown tests and confirm they pass.

### Task 4: Root query integration and safe presentation

**Files:**
- Modify: `src/app/page.tsx`
- Modify: `src/app/globals.css`
- Test: `tests/unit/remote-page.test.tsx`

**Interfaces:**
- Consume `searchParams: Promise<{ link?: string | string[] }>`.
- Render `DocumentView` for a valid remote document and a non-reflective error state for `RemoteMarkdownError`.

- [ ] Add failing page tests for unchanged no-query redirect, successful remote rendering, repeated-parameter rejection, and safe error output.
- [ ] Run `npm test -- tests/unit/remote-page.test.tsx` and confirm the expected failures.
- [ ] Add the `link` branch ahead of the existing local-project redirect and minimal standalone styling.
- [ ] Run focused page tests and confirm they pass.

### Task 5: Full verification

**Files:**
- Review all files above.

- [ ] Run `npm test`.
- [ ] Run `npm run typecheck`.
- [ ] Run `npm run lint`.
- [ ] Run `npm run build`.
- [ ] Run `git diff --check` and review `git diff --stat` plus `git status --short`.
