# Configurable Project Exclusions

## Goal

Allow each configured DocShare project to exclude files and directories with glob patterns. Excluded content must be absent from navigation and inaccessible through direct document or asset requests.

## Configuration

Each project may define an `exclude` array:

```yaml
projects:
  - id: product-docs
    title: Product Documentation
    path: ./docs
    homepage: README.md
    exclude:
      - "**/node_modules/**"
      - "**/*.draft.md"
      - "private"
```

The field is optional and defaults to an empty array. Every entry must be a non-empty string. Patterns are case-sensitive and match project-root-relative paths using `/` separators.

Directories are also matched with a trailing `/`. This makes a pattern such as `**/node_modules/**` exclude the directory itself before DocShare scans its children. When a directory path matches exactly, all of its descendants are excluded even if their full paths do not independently match.

## Architecture

`src/lib/exclusions.ts` owns portable path normalization and glob matching through Node.js 24's stable `path.matchesGlob()` API. It exposes one policy function that can check both a displayed/requested relative path and its canonical root-relative target.

`ProjectConfig` carries the validated `exclude` patterns. The repository applies the policy at its trust boundary:

- `getTree()` skips matching files and entire matching directory subtrees.
- `chooseHomepage()` never selects excluded automatic candidates.
- `read()` and `stream()` reject matching requested paths and matching canonical targets so an internal symlink cannot bypass a target exclusion.

Keeping enforcement in `DocumentRepository` covers the page renderer, content API, tree API, asset API, and watcher recovery scans without duplicating checks in each route.

## Homepage Rules

An explicit `homepage` that matches an exclusion is a configuration error. `loadConfig()` rejects it at startup or config reload rather than silently falling back.

Automatic homepage selection operates on the already-filtered tree. Its no-tree fallback also evaluates exclusions before validating `README.md` and `index.md`.

## Errors and Security

Excluded direct reads use the same non-specific access failure shape as other inaccessible repository entries. Browser responses must not disclose whether the path exists or was excluded.

The existing root-containment and symlink checks remain authoritative. Exclusion matching supplements them and does not replace filesystem canonicalization.

## Compatibility

Projects without `exclude` preserve existing behavior. No dependency is added. The repository already requires Node.js 24, and `path.matchesGlob()` is stable from Node.js 24.8 onward.

## Testing

- Configuration tests cover defaulting, accepted glob arrays, empty pattern rejection, and an excluded explicit homepage.
- Matcher tests cover portable paths, directory pruning semantics, exact directory exclusions, case sensitivity, and canonical-target checks.
- Repository tests prove excluded files/directories are absent from trees, direct buffered and streamed reads are rejected, symlink aliases cannot bypass exclusions, and automatic homepages skip excluded candidates.
- Integration tests verify excluded content is absent from the tree API and unavailable through content and asset APIs.
- README and the example YAML document the new field and semantics.
