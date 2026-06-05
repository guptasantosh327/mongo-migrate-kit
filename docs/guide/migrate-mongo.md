# Migrating from migrate-mongo

Already using [`migrate-mongo`](https://github.com/seppevs/migrate-mongo)? You can switch in under a
minute. `mmk` adopts your existing `changelog` **as-is** — no re-running migrations, no data loss, no
rewriting files.

## The one-command switch

```bash
mmk import     # one-time: adopt your migrate-mongo changelog (it is never modified)
mmk up         # applies only what's new — past migrations are recognized as already applied
```

Your applied history is preserved and new migrations run normally. Your `up`/`down`/`create`/`status`
mental model carries over 1:1.

## What `mmk import` does

`mmk import` reads your existing `migrate-mongo` changelog collection and records that history in the
mmk changelog, so `mmk up` runs only what is new. It is **one-time and forward-only**, and the source
collection is **never modified**.

- `--from <collection>` — source collection (default: `changelog`).
- `--to <collection>` — target collection (default: your config's `migrationsCollection`).
- `--dry-run` — preview the mapping, write nothing.
- `--trust-hash` — reuse `migrate-mongo`'s `fileHash` instead of recomputing the checksum from disk.
- `--force` — import into a non-empty mmk changelog (batches continue after the current max).
- `--no-lock` — skip the concurrency lock (dev only).

Each imported migration gets a unique, sequential batch number; files on disk that are **not** in the
source changelog stay pending.

See the full [`mmk import` command reference](/commands/import).

## Forward-only safety

Imported records are tagged `origin: 'migrate-mongo'`. Because their files use `migrate-mongo`'s
positional `up(db, client)` signature — which mmk's single-context-argument runner cannot execute
safely — `mmk down` and `mmk redo` **refuse them up front** (before running or writing anything) with
a clear reason. This guarantees the collection is never left half-reverted.

::: tip Going forward
New migrations you author with `mmk create` use the modern single-context signature and are fully
reversible. Only the *imported* legacy records are forward-only.
:::

## Capability comparison

| Capability                                      | `migrate-mongo` | `mongo-migrate-kit` |
| ----------------------------------------------- | :-------------: | :-----------------: |
| `up` / `down` / `create` / `status`             |        ✅        |          ✅          |
| Dry-run preview                                 |        ❌        |          ✅          |
| Run a single migration file                     |        ❌        |          ✅          |
| Roll back a specific batch (not just the last)  |        ❌        |          ✅          |
| `redo` (down + up)                              |        ❌        |          ✅          |
| SHA-256 checksum / tamper detection             |        ❌        |          ✅          |
| Lifecycle hooks                                 |        ❌        |          ✅          |
| First-class TypeScript (built-in)               |        ❌        |          ✅          |
| History preserved on rollback (never deleted)   |        ❌        |          ✅          |
