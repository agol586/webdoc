# Mermaid Refresh Error Isolation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent Mermaid's temporary `Syntax error in text` SVG from leaking into the page when a diagram render fails during refresh.

**Architecture:** Keep Mermaid's temporary DOM inside the existing component-owned `div.mermaid-diagram` by passing that element as the third argument to `mermaid.render`. The existing rejection handler will then remove the entire temporary render host before adding WebDoc's safe fallback message and source.

**Tech Stack:** React 19, TypeScript, Mermaid 11.16.0, Vitest, Testing Library, jsdom

## Global Constraints

- Preserve the existing success rendering, source normalization, cancellation, and fallback behavior.
- Do not change watcher timing, add retries, modify global Mermaid configuration, or alter source normalization.
- Mermaid's internal `Syntax error in text` content must not remain in the active document after rejection.
- Do not modify or include the pre-existing working-tree changes in `next-env.d.ts` or `tests/unit/repository.test.ts`.

---

### Task 1: Isolate Mermaid's Temporary Render DOM

**Files:**
- Modify: `tests/unit/components.test.tsx:98-104`
- Modify: `src/components/mermaid-blocks.tsx:113`

**Interfaces:**
- Consumes: Mermaid 11.16.0's `render(id: string, text: string, svgContainingElement?: Element)` API and the existing `diagram: HTMLDivElement` placeholder.
- Produces: A `MermaidBlocks` failure path that removes Mermaid's temporary error DOM and retains WebDoc's existing fallback UI.

- [ ] **Step 1: Replace the existing failure test with a regression test that simulates Mermaid's leaked error DOM**

Replace the `shows Mermaid source when rendering fails` test in `tests/unit/components.test.tsx` with:

```tsx
it("removes Mermaid temporary error rendering when rendering fails", async () => {
  mockMermaidRender.mockImplementation(
    (_id: string, _source: string, container?: HTMLElement) => {
      const error = document.createElement("p");
      error.textContent = "Syntax error in text";
      (container ?? document.body).append(error);
      return Promise.reject(new Error("bad diagram"));
    },
  );

  render(
    <MermaidBlocks
      html={'<pre class="mermaid" data-mermaid-source="broken"></pre>'}
      path="README.md"
    />,
  );

  expect(await screen.findByText(/diagram could not be rendered/i)).toBeVisible();
  expect(screen.getByText("broken")).toBeVisible();
  expect(screen.queryByText("Syntax error in text")).not.toBeInTheDocument();
  expect(mockMermaidRender).toHaveBeenCalledWith(
    expect.stringMatching(/^mermaid-.*-0$/),
    "broken",
    expect.any(HTMLDivElement),
  );
});
```

- [ ] **Step 2: Run the focused test and verify the regression is red**

Run:

```bash
npm test -- tests/unit/components.test.tsx -t "removes Mermaid temporary error rendering when rendering fails"
```

Expected: FAIL because the current two-argument `mermaid.render` call gives the mock no container, causing `Syntax error in text` to remain under `document.body`; the call-argument assertion also reports the missing third argument.

- [ ] **Step 3: Pass the component-owned placeholder to Mermaid**

In `src/components/mermaid-blocks.tsx`, change the render call from:

```ts
void mermaid.render(`mermaid-${stableHash(path)}-${index}`, source).then(
```

to:

```ts
void mermaid.render(`mermaid-${stableHash(path)}-${index}`, source, diagram).then(
```

Do not change either promise handler. On rejection, `diagram.remove()` now removes both the placeholder and Mermaid's temporary error content before the existing fallback is appended.

- [ ] **Step 4: Run the focused test and verify it is green**

Run:

```bash
npm test -- tests/unit/components.test.tsx -t "removes Mermaid temporary error rendering when rendering fails"
```

Expected: PASS. The application fallback and `broken` source are visible, `Syntax error in text` is absent, and the mock received an `HTMLDivElement` third argument.

- [ ] **Step 5: Run the complete verification suite**

Run:

```bash
npm test
npm run typecheck
npm run lint
```

Expected: all unit tests pass, TypeScript reports no errors, and ESLint reports no errors.

- [ ] **Step 6: Review the final diff and commit only the fix files**

Run:

```bash
git diff --check
git diff -- src/components/mermaid-blocks.tsx tests/unit/components.test.tsx
git status --short
git add src/components/mermaid-blocks.tsx tests/unit/components.test.tsx
git commit -m "fix: isolate Mermaid render errors"
```

Expected: the reviewed diff contains only the one render-call change and its regression test. The commit excludes `next-env.d.ts` and `tests/unit/repository.test.ts`.
