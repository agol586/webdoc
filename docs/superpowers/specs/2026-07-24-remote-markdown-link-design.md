# Remote Markdown Link Design

## Goal

Allow `/?link=<encoded HTTPS URL>` to render a Markdown document fetched from the public Internet without turning DocShare into an SSRF proxy.

## Chosen approach

The server fetches the document because the existing Markdown renderer is server-side. Every outbound hop is fail-closed: only HTTPS is accepted, credentials and repeated `link` parameters are rejected, DNS answers must all be globally routable, the validated address is pinned into the TLS request, and every redirect is resolved and validated again.

Alternatives rejected:

- Browser-side fetching avoids server-side SSRF but fails on CORS, exposes inconsistent behavior, and bypasses the existing server renderer.
- A domain allowlist is simpler and strongest but does not meet the requirement to support arbitrary public links.
- Plain `fetch()` after a DNS check is vulnerable to DNS rebinding because validation and connection resolution are separate operations.

## Components and data flow

1. `src/remote/public-address.ts` classifies IPv4 and IPv6 addresses and accepts only globally routable destinations.
2. `src/remote/fetch-markdown.ts` parses the URL, resolves and validates every DNS answer, pins one validated address into `https.request`, limits redirects, time, content type, and bytes, and returns the final URL with UTF-8 Markdown.
3. `src/markdown/links.ts` gains a remote-link rewriting mode. Relative links resolve against the final response URL; only HTTP(S) links and `mailto:` anchors survive. Existing CSP continues to block remote images, preventing tracking and active remote SVG content.
4. `src/app/page.tsx` keeps its current redirect behavior when `link` is absent. With exactly one `link`, it fetches, renders, and displays a standalone document. Expected policy/network failures render a generic safe error without reflecting attacker-controlled content.

## Security invariants

- Only `https:` URLs, no embedded username/password, maximum URL length 2,048 characters.
- Reject loopback, private, link-local, carrier-grade NAT, documentation, benchmark, multicast, reserved, unspecified, and IPv4-mapped unsafe addresses.
- Reject a hostname if any DNS answer is non-public; pin a validated address into the TLS connection.
- Revalidate each redirect; allow at most three redirects.
- Ten-second total request deadline and the configured `limits.markdownBytes` response cap, enforced before and during streaming.
- Accept Markdown-compatible textual responses only; do not send cookies, authorization, referrer, or proxy attacker-controlled headers.
- Keep raw HTML disabled in Markdown. Keep Mermaid at `securityLevel: "strict"` and existing CSP unchanged.

## Error handling and tests

Policy, resolution, redirect, timeout, content-type, HTTP status, and size failures use a typed `RemoteMarkdownError` with non-secret user-facing messages. Unit tests cover address classification and a dependency-injected transport so DNS pinning, redirect revalidation, and bounded streaming are deterministic. Markdown tests cover final-URL-relative links and unsafe schemes. Page-level behavior is kept thin and typechecked.
