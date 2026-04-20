# Changelog

All notable changes to this extension are documented in this file.

## 0.1.7

### Added
- Run queries from any file using the `// @firestore-query` marker comment — no more restriction to `.firestore/queries/`. Works with `.js`, `.ts`, `.mjs`, and `.cjs`. CodeLens, connection selector, and `Cmd+Enter` all activate automatically.
- **Stop** button on connections that are currently attempting to connect, so you can bail out of a slow handshake without waiting.

### Changed
- Emulator connections now run a fast TCP reachability probe (2s) before the full Firestore handshake, so an offline emulator surfaces as `⚠ unreachable` in under two seconds instead of hanging on gRPC retries.
- Connection attempts are bounded: 5s verify timeout for emulators, 15s for production.
- Connection tree shows a new `connecting…` state with a spinner while an attempt is in flight.
- `queries.config.json` now stores workspace-relative paths so connection mappings work for queries outside `.firestore/queries/`. Older queries-dir-relative keys are still read for backwards compatibility.

## 0.1.6

- Find document by ID from the collection view.

## 0.1.5

- Saved queries with connection config, split results panel, `Cmd+Enter` to run the active query.

## 0.1.4

- Replaced env-var-based auth with direct emulator REST API calls.

## 0.1.3

- Added auth docs to README, extension logo, ProductiveHub link.
