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

## Review follow-up RED/GREEN

- **Asset navigation RED:** expanded the tree test with image and attachment nodes. It failed because directories had no link and attachments still used `/p`. **GREEN:** image nodes keep stable `/p/...` deep links, attachment nodes use `/api/assets/...`, and directory summaries contain real stable links.
- **Drawer focus RED:** added a keyboard test that opened the drawer, expected initial focus, wrapped backward with Shift+Tab, closed with Escape, and expected trigger focus restoration. It failed because focus escaped to the desktop tree. **GREEN:** drawer key handling now traps Tab/Shift+Tab, handles Escape, and restores the trigger.
- **Image preview RED:** added a test for a deep-linked image rendered from the safe asset endpoint. It failed because `ImageView` did not exist. **GREEN:** `/p/:projectId/:imagePath` now renders an `<img>` in the reader pane using the encoded `/api/assets/...` URL.
- **Error classification RED:** added focused classification tests; they initially failed because no page error classifier existed. **GREEN:** only `ENOENT` and `ENOTDIR` become 404s; `EACCES`, `FileTooLargeError`, `PathPolicyError`, and internal renderer errors propagate.

### Follow-up verification

- `npm test -- tests/unit/components.test.tsx tests/unit/page-errors.test.ts`: 11 tests passed.
- `npm run typecheck`: passed.
- `npm test`: 7 files and 97 tests passed.
- `npm run build`: passed with the same non-fatal Turbopack NFT tracing warning noted above.

## Image active-path follow-up RED/GREEN

- **RED:** added `page-selection.test.ts` to require image paths to take precedence over Markdown paths and empty projects to yield no active path. The focused test failed because the selection helper did not exist, matching the page's direct use of the emptied `documentPath` after selecting an image.
- **GREEN:** added `selectActivePath(imagePath, documentPath)` and wired the reader page to pass its result into `AppShell`. Deep-linked images now retain `aria-current` and expand their parent directories.
- **Verification:** `npm test -- tests/unit/page-selection.test.ts tests/unit/components.test.tsx` passed 8/8 tests; `npm run typecheck` passed.
