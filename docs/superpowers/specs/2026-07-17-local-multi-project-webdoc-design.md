# Local Multi-Project WebDoc Design

## Goal

Build a personal or internal-network documentation viewer that dynamically reads multiple configured local documentation directories. It renders Markdown and images in a browser and reflects file changes without rebuilding a static site.

## Scope

The first release includes:

- multiple projects configured in YAML;
- a project switcher, file tree, and document viewer;
- GitHub Flavored Markdown, syntax highlighting, heading anchors, and task lists;
- Mermaid diagrams;
- relative Markdown links and relative image paths;
- direct image preview and safe attachment access;
- automatic refresh when configuration or documentation changes;
- stable URLs that restore the selected project and document.

The first release excludes authentication, full-text search, editing, Git synchronization, version history, and public-internet deployment.

## Architecture

The application is a TypeScript and Next.js monolith. The server process must have read access to each configured documentation directory.

The implementation is divided into focused modules:

- **Configuration loader:** reads and validates `webdoc.config.yaml`.
- **Path policy:** resolves requested paths and ensures they stay within the configured project root.
- **Document repository:** scans directories and returns sorted file trees and file metadata.
- **Content service:** reads UTF-8 Markdown, parses optional frontmatter, and supplies page metadata.
- **Asset service:** returns allowed images and attachments with safe content types.
- **Renderer:** renders GFM, syntax highlighting, heading anchors, relative links, and Mermaid.
- **Watcher:** observes the configuration file and project roots, invalidates caches, and publishes change events.
- **Web interface:** provides the project selector, file tree, document view, and responsive navigation.

The first release reads document content from disk on demand. File trees may use a short-lived cache that is invalidated by the watcher. It does not maintain a separate persistent or full in-memory content index.

## Configuration

The application reads a YAML file with this shape:

```yaml
server:
  host: 127.0.0.1
  port: 3030

projects:
  - id: aave-bots-v4
    title: Aave Bots V4
    path: /home/user/repos/aave-bots-v4/docs
    homepage: README.md
```

The default listener is `127.0.0.1:3030`. Project IDs must be unique and URL-safe. Each project path is resolved to an absolute canonical path. `homepage` is optional and must resolve to a Markdown file inside the project root.

Invalid top-level configuration prevents startup and reports the exact invalid field. A project directory that becomes unavailable after startup is marked unavailable without taking other projects offline.

## Routes and Navigation

Documents use stable routes:

```text
/p/[projectId]/[...documentPath]
```

The root route redirects to the first configured project's homepage. A project's homepage is chosen in this order:

1. the configured `homepage`;
2. root `README.md`, compared case-insensitively;
3. root `index.md`, compared case-insensitively;
4. the first Markdown file in the sorted tree.

If a project has no Markdown files, its project page displays the file tree and an empty-state message rather than redirecting.

The desktop layout uses a top project switcher, left file tree, and right content pane. On narrow screens, the file tree becomes a drawer while the content remains the primary view.

Directories sort before files. Entries sort naturally and case-insensitively within each group. The tree displays directories, Markdown files, supported images, and other allowed attachments.

## Markdown and Asset Rendering

Markdown supports GFM tables, task lists, fenced code, syntax highlighting, and deterministic heading anchors. Raw HTML is disabled. External links open in a new tab with safe `rel` attributes.

Relative links are resolved against the current document path:

- links to Markdown files become internal document routes;
- links to directories resolve using the homepage rules for that directory where possible;
- image paths use the asset endpoint;
- other allowed files use the attachment endpoint;
- paths outside the project root are rejected.

Mermaid fenced blocks render on the client. A failed diagram shows a local error and preserves the diagram source without preventing the rest of the page from rendering.

Supported inline images are PNG, JPEG, GIF, WebP, AVIF, and SVG. SVG is returned with image-safe response headers and is never injected as raw page markup. Unknown file types are offered as downloads rather than rendered inline.

The server enforces configurable file-size limits. The initial defaults are 5 MiB for Markdown and 25 MiB for assets. Oversized files return a clear error without being fully buffered.

## Change Detection

The watcher observes the YAML configuration and every configured project root. It debounces bursts of filesystem events, invalidates affected file-tree and content cache entries, and sends a project-scoped change event to connected browsers.

When the active document changes, the browser reloads it. When any path in the active project changes, the browser refreshes the file tree. Configuration changes add, update, or remove projects without restarting when the new configuration is valid. If a reloaded configuration is invalid, the running application retains the last valid configuration and reports the reload error in logs and the interface.

## Security Model

The service is intended for localhost or a trusted internal network and has no application-level authentication in the first release. It listens on `127.0.0.1` by default. Binding to `0.0.0.0` must be explicit and should be combined with firewall or reverse-proxy access controls.

Every requested path is decoded once, joined to its configured project root, canonicalized, and checked against that root before access. The same policy applies to documents, images, downloads, homepage paths, and Markdown-relative links. Encoded traversal and absolute-path inputs are rejected.

Symbolic links are allowed only when their canonical target remains inside the same configured project root. Broken links and links escaping the root are omitted from trees and rejected on direct access. Directory scans detect filesystem cycles.

Markdown raw HTML is disabled. Content Security Policy restricts script and object execution. File responses set explicit content types, `X-Content-Type-Options: nosniff`, and safe content dispositions.

## Error Handling

- Missing or deleted documents return a 404 view and trigger a file-tree refresh.
- Unreadable files show a scoped error without taking down the process.
- Temporarily unavailable projects show an unavailable state while other projects remain usable.
- Unsupported inline formats are downloadable but are not executed or embedded.
- Watcher overflow or failure triggers a bounded full rescan and reports degraded live-refresh status.
- Client change streams reconnect with backoff and normal page navigation continues if live refresh is unavailable.

## Testing

Unit tests cover configuration validation, natural tree sorting, homepage selection, canonical path enforcement, encoded traversal, symbolic-link escape and cycles, relative-link rewriting, file-size limits, content types, GFM behavior, and Mermaid fallback behavior.

Integration tests create temporary multi-project directory fixtures and verify project switching, route restoration, document and asset responses, unavailable projects, configuration reload, and filesystem-change events.

Browser tests cover the desktop two-column layout, mobile drawer, Markdown navigation, image preview, external links, Mermaid rendering and failure fallback, 404 behavior, and automatic refresh of an open document.

## Success Criteria

The release is complete when a user can configure at least two local documentation roots, start one Next.js service, browse each project's tree, render Markdown and images with correct relative links, view Mermaid diagrams, refresh a stable document URL directly, and see saved filesystem changes appear without rebuilding or restarting the service.
