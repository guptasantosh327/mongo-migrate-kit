# Changelog

All notable changes to this project will be documented in this file.

## v1.0.0

Initial release.

- Core `MigratorKit` orchestration: `up`, `down`, `redo`, `dryRun`, `status`, `list`, `create`, `init`
- `mmk` CLI with `init`, `up`, `down`, `redo`, `status`, `list`, `dry-run`, and `create` commands
- Config loader with priority: CLI flags → env vars → config file → defaults (zod-validated)
- Function / async config files — `export default` a (sync or async) factory returning the config,
  for loading the connection from a secret manager at runtime with no bundled cloud SDKs
- First-class `.ts` and `.js` (ESM + CJS) migration loading
- MongoDB-native concurrency lock with TTL-based stale reclaim
- SHA-256 checksum tamper detection, surfaced in `status`
- Opt-in transactions (per-file or global) with automatic commit/abort
- Lifecycle hooks: `beforeAll`, `afterAll`, `beforeEach`, `afterEach`, `onError`
- Append-only audit trail in `_mmk_migrations` — reverts are never deleted
- `mmk init` config-file generator (`--ts`/`--js`/`--json`, `--force`, `--secret-provider`)
- `createExtension` option + `mmk create --js`/`--ts` to choose the generated file type
- `mmk up <file> --force` to re-run an already-applied migration (with confirmation)
