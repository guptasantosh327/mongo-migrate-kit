# Why mongo-migrate-kit?

Most MongoDB migration tools run every pending migration, then only undo the last one.
`mongo-migrate-kit` gives you precise control over what runs and what rolls back — and won't leave
your database half-migrated when something fails.

## Reasons to choose it

- **Run a single migration** — `mmk up <file>`, not just "all pending".
- **Roll back anything** — a batch (`--batch 3`), the last N (`--steps 2`), one file, or `redo`.
- **Preview before you run** — `mmk dry-run up` prints the exact plan without touching the database.
- **No race conditions** — an atomic MongoDB lock stops two deploys running migrations at once.
- **Tamper detection** — SHA-256 checksums catch a migration edited after it was applied.
- **Audit trail kept** — a rollback updates the record, it never deletes it.
- **Lifecycle hooks** — `beforeAll`, `afterAll`, `beforeEach`, `afterEach`, `onError`.
- **Opt-in transactions** — wrap a migration so it fully commits or fully aborts.
- **TypeScript, ESM & CommonJS** — all run with no `ts-node` plumbing.
- **Zero config files required** — drive everything from env vars if you prefer.

## vs. migrate-mongo

| Capability                                      | `migrate-mongo` | `mongo-migrate-kit` |
| ----------------------------------------------- | :-------------: | :-----------------: |
| Run a single migration file                     |        ❌        |          ✅          |
| Roll back a specific batch (not just the last)  |        ❌        |          ✅          |
| Dry-run preview                                 |        ❌        |          ✅          |
| `redo` (down + up)                              |        ❌        |          ✅          |
| Checksum / tamper detection                     |        ❌        |          ✅          |
| Lifecycle hooks                                 |        ❌        |          ✅          |
| First-class TypeScript (no setup)               |        ❌        |          ✅          |
| History kept on rollback (never deleted)        |        ❌        |          ✅          |

::: tip Already on migrate-mongo?
Switch in one command — `mmk import` adopts your existing `changelog` as-is, with no re-running and
no data loss. See [Migrating from migrate-mongo](/guide/migrate-mongo).
:::

## Next

- [Getting Started](/guide/getting-started) — install and run your first migration.
- [Writing Migrations](/guide/writing-migrations) — the `up`/`down` contract.
