# DocShare Rename and Mermaid Controls Design

## Goal

Rename the active application from WebDoc to DocShare throughout its code, configuration, commands, documentation, tests, fixtures, metadata, logs, and runtime identifiers. Add dependency-free controls to every successfully rendered Mermaid diagram so readers can zoom, reset, and pan the diagram.

## Naming Migration

All active project surfaces use the new name:

- Product copy and metadata use `DocShare`.
- Package and lowercase identifiers use `docshare`.
- The default configuration file becomes `docshare.config.yaml`.
- The configuration environment variable becomes `DOCSHARE_CONFIG`.
- Launcher files become `scripts/docshare-server.ts`, `scripts/docshare-server-args.ts`, and `scripts/start-docshare.sh`.
- TypeScript configuration types become `DocShareConfig`.
- Runtime globals use `__docshare...` keys.
- Logs and command usage messages identify DocShare.
- Current README instructions, tests, fixtures, and configuration examples use the new names.

The migration intentionally does not retain aliases for `webdoc.config.yaml`, `WEBDOC_CONFIG`, or the old launcher paths. This is a complete rename rather than a compatibility migration. Historical design and implementation records under `docs/superpowers/` retain their original wording because they describe the repository state at the time they were written; this new design records the rename.

## Mermaid Interaction Design

Each successfully rendered diagram is placed in an interaction wrapper containing:

- A toolbar in the upper-right corner with accessible icon buttons for zoom in, zoom out, reset, and pan mode.
- A viewport that clips overflow and owns pointer and wheel interactions.
- The Mermaid-generated SVG, controlled through its `viewBox` rather than CSS scaling so text and lines remain sharp.

The component stores interaction state independently per diagram. Zoom buttons and wheel gestures change the visible `viewBox` around its center. Reset restores the SVG's original `viewBox`. When pan mode is active, pointer dragging translates the `viewBox`; pointer capture keeps the gesture stable if the pointer leaves the diagram temporarily. The pan button exposes its pressed state through `aria-pressed`, and the viewport cursor changes to communicate whether dragging is available or active.

Controls use inline React/DOM-created SVG icons and existing application CSS. No new package is introduced. Button labels remain available to assistive technology through `aria-label` and `title` attributes.

## Render and Error Flow

1. `MermaidBlocks` discovers and normalizes Mermaid sources as it does today.
2. It creates a diagram host owned by the corresponding Mermaid block and passes that host to `mermaid.render`.
3. On success, it installs the returned SVG, reads or derives its initial `viewBox`, and mounts the toolbar and viewport behavior.
4. On failure, it removes temporary rendering DOM and preserves the existing safe error message and source fallback. No inactive toolbar is shown.
5. Effect cleanup marks pending renders as cancelled and removes interaction listeners installed for completed diagrams.

## Styling

The diagram wrapper remains visually consistent with the document reader. The toolbar floats above the diagram without obscuring normal document controls, uses compact high-contrast buttons, and wraps safely on narrow screens. The viewport has a bounded minimum height, allows the diagram to fit its content initially, and visibly indicates pan mode. Focus styles remain keyboard-visible.

## Testing

Development follows test-first changes:

- Rename tests assert package scripts, launcher usage, default config lookup, environment-variable lookup, metadata, runtime globals, logs, README examples, and fixture paths use DocShare names and reject unintended active WebDoc references.
- Component tests first assert that successful Mermaid renders gain four accessible controls while failed renders do not.
- Interaction tests cover zoom in, zoom out, reset, pan toggle, pointer dragging, and wheel zoom by observing SVG `viewBox` changes.
- Existing Mermaid normalization and error-isolation tests continue to pass.
- End-to-end coverage verifies the renamed application starts from the renamed fixture configuration and that controls are visible on rendered diagrams.
- Final verification runs unit/integration tests, type checking, lint, production build, and Playwright tests.

## Constraints and Non-Goals

- No new runtime or development dependency.
- No persistence of zoom/pan state across navigation or refresh.
- No touch pinch-to-zoom in this change; pointer dragging remains compatible with pointer-capable devices.
- No compatibility alias for old WebDoc command, file, environment-variable, or type names.
- Historical records are not rewritten.

