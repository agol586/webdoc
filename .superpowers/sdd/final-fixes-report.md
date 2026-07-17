# Final fixes report

Base: `b4369e7`

## Findings addressed

1. Explicit homepages are validated during config loading after canonicalizing the project root through the shared path-policy helper. Validation requires containment, existence, a regular file, and `.md`; rejected reloads retain the last valid config.
2. `chooseHomepage` consumes the supplied tree: case-insensitive root `README.md`, root `index.md`, then depth-first first Markdown. Tests cover mixed case and a directory sorted before the root README.
3. Relative Markdown links route `.md` and extensionless/directory paths to `/p`; images and other extensions route to `/api/assets`. Existing encoding and scheme-safety tests remain green; PDF attachment routing has a unit regression test.
4. `/` checks only first-project availability and redirects unavailable projects to `/p/:id`, leaving scoped unavailable rendering in charge rather than scanning the tree.
5. Reload and recovery failures emit server-side diagnostics with error category and message; browser status events remain generic. Watcher spies cover both catches.
6. README requires/records verified Node 24, recommends `npm ci`, records the current 2 moderate audit findings, discusses `allowScripts`, and warns about Turbopack output tracing. `package.json` declares Node >=24.

## TDD evidence

Initial focused RED run: 7 failures (4 config homepage, 2 tree homepage, 1 PDF routing), 60 passing. After minimal implementation, the focused suite passed; watcher diagnostic spy tests pass.

## Verification

- `npm install --package-lock-only --ignore-scripts`: passed; audited 669 packages, 2 moderate vulnerabilities.
- `npm test`: 13 files, 134 tests passed.
- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `npm run build`: passed. Turbopack emitted the known unexpected NFT tracing warning for `next.config.ts` via server context.
- `npm run test:e2e`: 13 passed, 1 intentionally skipped across desktop/mobile Chromium.
- `npx vitest run tests/unit/watcher.test.ts`: 12 passed after diagnostic spy additions.
- `git diff --check`: passed.

## Concerns

- The two moderate dependency audit findings remain and require a breaking `npm audit fix --force`; no forced upgrade was applied.
- Turbopack reports broad output-file tracing. README now calls out preserving traced artifacts for release packaging; resolving the trace itself is outside this finding set.

## Follow-up final review

- Removed extension-based attachment guessing from Markdown AST rewriting. All ordinary relative anchors, including `manual.pdf`, `LICENSE`, and dotted `v1.0`, now route through `/p`; image nodes remain `/api/assets`.
- Added tree-node-driven page destinations: real attachment nodes redirect to the bounded asset endpoint, directories (including dotted names) resolve their Markdown homepage, Markdown renders, and images retain preview behavior.
- Recovery catches now suppress diagnostics only after this watcher instance is closed or its config epoch changes. Current deadline, budget, and repository errors remain diagnostic.
- RED: focused tests initially had 5 expected failures (three routing behaviors grouped in renderer coverage, two node helpers, and active-abort logging assertions).
- GREEN verification: focused 43 passed; full `npm test` 136 passed; typecheck/lint/build passed; E2E 13 passed and 1 skipped. The existing Turbopack tracing warning remains unchanged.
