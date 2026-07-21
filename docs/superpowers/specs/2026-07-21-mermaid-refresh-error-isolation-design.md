# Mermaid Refresh Error Isolation Design

## Problem

`MermaidBlocks` calls `mermaid.render(id, source)` without a rendering container. Mermaid 11.16 therefore creates its temporary rendering DOM under `document.body`. When parsing fails, Mermaid leaves an error SVG containing `Syntax error in text` in that global location before rejecting the render promise.

The component handles the rejected promise by replacing its own diagram placeholder with a safe fallback, but it cannot remove Mermaid's separate global error SVG. During live refresh, a transiently incomplete diagram can therefore leave a large Mermaid error block outside the document's diagram area.

## Selected Approach

Pass the component-owned diagram placeholder as the third argument to `mermaid.render`:

```ts
mermaid.render(id, source, diagram)
```

Mermaid will create all temporary rendering elements inside that placeholder. On success, the component replaces the temporary contents with the returned SVG. On failure, the existing rejection handler removes the entire placeholder, including Mermaid's error SVG, before showing the application's fallback message and source.

## Component and Data Flow

1. `MermaidBlocks` finds each `pre.mermaid` element and normalizes its source as it does today.
2. It creates a `div.mermaid-diagram` placeholder owned by that block.
3. It passes the placeholder to `mermaid.render` as the rendering container.
4. On success, if the effect is still current, it writes the returned SVG into the placeholder.
5. On failure, if the effect is still current, it removes the placeholder and appends only the existing safe fallback UI.
6. If a refresh or unmount cancels the effect, the old placeholder is already detached with the old rendered HTML; late completion cannot modify the current document.

No watcher timing or Mermaid source-normalization behavior changes are included.

## Error Handling

Valid diagrams continue to render normally. Invalid or transiently incomplete diagrams show only:

- `Diagram could not be rendered.`
- the normalized Mermaid source

Mermaid's internal `Syntax error in text` SVG must not remain anywhere in the active document.

## Testing

Add a component regression test whose Mermaid mock behaves like the failing Mermaid path:

1. Append a visible `Syntax error in text` marker to the supplied rendering container, or to `document.body` when no container is supplied.
2. Reject the render promise.
3. Assert that the application fallback and source are visible.
4. Assert that `Syntax error in text` is absent from the document.
5. Assert that `mermaid.render` received the component-owned placeholder as its third argument.

The test must fail against the current two-argument call and pass after the production change. Run the focused component test, then the full unit suite, typecheck, and lint.

## Scope

This is a focused DOM-isolation fix. It does not debounce live refresh differently, retry invalid diagrams, change Mermaid configuration globally, or alter source normalization.
