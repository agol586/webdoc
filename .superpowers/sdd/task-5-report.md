# Task 5 Report: Stable Routes and Two-Column Reader UI

## Outcome

Implemented the App Router document reader with dynamic, stable project/document routes, root homepage redirection, a responsive two-column shell, accessible document navigation, and strict client-side Mermaid rendering with source-preserving fallback.

## TDD evidence

- Added `tests/unit/components.test.tsx` before component implementation.
- Initial run failed first on the absent `@testing-library/user-event` dependency, then (after adding it) on the absent component modules.
- Implemented the minimal components and observed all three behavior tests pass.
- The first production build failed because Next 16 attempted to prerender `/` and read runtime configuration; marking filesystem-backed pages `force-dynamic` made the next build pass.

## Implemented behavior

- `/` redirects to the first configured project's chosen homepage (or its project root when it has no Markdown).
- `/p/[projectId]/[[...path]]` validates projects and tree paths, redirects project/directory routes to a Markdown homepage, and calls `notFound()` for missing/non-Markdown document content.
- Projects without Markdown render the tree and an empty state.
- Sticky project selector, desktop tree navigation, content pane, and a sub-768px focus-managed mobile drawer.
- Tree uses nested lists, real links, `aria-current`, labeled navigation, and active-directory expansion.
- Mermaid initializes with `securityLevel: "strict"`; SVG is inserted only in a dedicated diagram node, while failures retain source as text and show a localized error.
- Wide tables and code blocks scroll horizontally without widening the document pane.
- Client boundaries receive only serializable project/tree data and rendered React children, never server context or repository instances.

## Verification

- `npm test -- tests/unit/components.test.tsx`
- `npm run typecheck`
- `npm run build`

All passed. Build emits an existing Turbopack NFT tracing warning related to dynamic filesystem access through `next.config.ts`; it does not fail compilation or route generation.

## Self-review notes

- Route path components and project IDs are encoded independently.
- Mermaid fallback uses `textContent`, preventing failed diagram source from becoming executable markup.
- Next 16 server/client serialization constraints are respected.
- No server repository object crosses into a client component.
