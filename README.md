# DocShare

DocShare serves multiple local Markdown projects through a responsive web reader with navigation, syntax highlighting, Mermaid diagrams, and live refresh.

## Mermaid diagram controls

Every rendered Mermaid diagram includes controls to zoom in, zoom out, reset the view, and enable pan mode. The mouse wheel also zooms the diagram. Enable pan mode, then drag the diagram to move around a zoomed view.

## Setup

Requires Node.js 24 or newer; Node 24 is the verified release line. A clean checkout should use `npm ci` for reproducible installation.

```bash
cp docshare.config.example.yaml docshare.config.yaml
npm ci
npm run dev
```

Open `http://127.0.0.1:3030`. For a production build, run:

```bash
npm run build && npm start
```

## Configuration

DocShare reads `docshare.config.yaml` from the working directory. Set `DOCSHARE_CONFIG` to an absolute or working-directory-relative path to use another file.

```yaml
server:
  host: 127.0.0.1
  port: 3030
limits:
  markdownBytes: 5242880
  assetBytes: 26214400
projects:
  - id: product-docs
    title: Product Documentation
    path: ./docs
    homepage: README.md
    exclude:
      - "**/node_modules/**"
      - "**/*.draft.md"
      - private
```

- `server.host` and `server.port` control the exact listener used by both `npm run dev` and `npm start`. Defaults are `127.0.0.1:3030`; binding `0.0.0.0` requires an explicit YAML value.
- `limits.markdownBytes` defaults to 5 MiB and limits Markdown reads.
- `limits.assetBytes` defaults to 25 MiB and limits images and downloadable attachments.
- Every `projects` entry needs a URL-safe lowercase `id`, display `title`, and directory `path`. Paths are resolved relative to the config file.
- `homepage` is optional and must name Markdown inside the project. An explicit homepage wins; otherwise DocShare tries root `README.md`, then root `index.md`, then the first Markdown document for navigation fallbacks.
- `exclude` is an optional per-project list of case-sensitive glob patterns matched against `/`-separated paths relative to the project root. Exact directory matches exclude all descendants, while patterns such as `**/node_modules/**` prune every matching directory. Excluded files and directories are omitted from navigation and cannot be read through document or asset URLs. An explicit `homepage` must not match an exclusion.

`npm audit` currently reports 2 moderate vulnerabilities in transitive development dependencies. Review them when updating the lockfile. Keep npm lifecycle scripts restricted with your environment's `allowScripts` policy, and explicitly review any package newly permitted to run install scripts.

When packaging a production build, preserve Next.js/Turbopack output-file tracing artifacts (including `.next/standalone` and traced dependencies); copying only static assets can produce a build that starts but fails at runtime.

Markdown (`.md`) is rendered with GitHub-flavored tables and task lists, syntax-highlighted fenced code, and Mermaid fenced diagrams. Common AVIF, GIF, JPEG, PNG, SVG, and WebP images are previewed; other regular files are exposed as bounded attachments.

## Security and network exposure

DocShare confines resolved document paths to configured project roots, rejects traversal and unsafe link schemes, removes raw HTML from Markdown, applies a restrictive Content Security Policy, and sends anti-sniffing, no-referrer, and frame-denial headers. Errors shown to browsers are generic and do not include filesystem paths or stack traces.

The default localhost binding is deliberate. Binding to `0.0.0.0`, a LAN address, or another internal-network interface exposes the configured files to anyone who can reach that listener; DocShare does not provide authentication or TLS. For shared or production access, keep DocShare on a private listener and put an authenticated TLS reverse proxy in front of it. Restrict the proxy and host firewall to intended users.

## Troubleshooting

- **Project unavailable:** confirm its configured directory exists, is a directory, and the DocShare process can read it. Relative paths are relative to the YAML file, not necessarily the shell directory.
- **Startup says a directory is missing or unreadable:** correct permissions or the path, then restart. DocShare resolves project roots while loading configuration.
- **Live refresh disconnected or degraded:** documents still render and manual reload remains available. Check file-watcher limits, permissions, network/proxy buffering of `/api/events`, and whether the project directory is on a filesystem that supports change notifications; then restart after correcting the cause.
- **File too large:** raise the corresponding byte limit only after considering memory use and the trust level of the exposed project.
- **Wrong landing document:** verify the explicit `homepage`; if omitted, check the root `README.md` and `index.md` precedence above.
