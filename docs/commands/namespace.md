# mmk namespace adopt

Move this repo's migration records from before it had a `namespace` into its namespace. One-time,
and only for an **existing** repo moving into a [namespace](/guide/shared-database) — new repos never
need it, and an existing repo may also simply stay without a namespace.

```bash
mmk namespace adopt [options]
```

## When you need it

After you add `namespace: 'orders-api'` to a repo that already ran migrations, its old records still
have no namespace, so in the new namespace those migrations would look pending — and `mmk up` would
run them a second time. Until they're adopted, every command whose answer depends on what's applied
refuses with `NAMESPACE_UNADOPTED`: `up`, `down`, `redo`, `import`, `dry-run`,
`list --pending` / `--applied`, and `pendingMigrations()`. `status` and `list` keep working, warn, and
mark those rows `unadopted`; `status --check` names `adopt` as the reason it fails.

## Usage

```bash
mmk namespace adopt --dry-run   # preview what would move
mmk namespace adopt             # move it
mmk namespace adopt --json      # machine-readable result
```

The preview lists each record with who ran it, as a hint for review:

```
Namespace: orders-api
◎ Dry-run  Would adopt 2 record(s) into namespace "orders-api"
┌──────────────────────────────────────────┬─────────┬───────┬─────────────────────┬─────────────┬────────────┐
│ Migration                                │ Status  │ Batch │ Applied At          │ Executed By │ Service    │
├──────────────────────────────────────────┼─────────┼───────┼─────────────────────┼─────────────┼────────────┤
│ 20261001090000-create-orders-indexes.js  │ applied │ 1     │ 2026-10-01 09:00:02 │ deploy      │ orders-api │
│ 20261001093000-backfill-order-totals.js  │ applied │ 1     │ 2026-10-01 09:00:05 │ deploy      │ orders-api │
└──────────────────────────────────────────┴─────────┴───────┴─────────────────────┴─────────────┴────────────┘
```

## What moves

- Records **without a namespace** whose filename is in this repo's migrations folder — in any status.
- Nothing else. Records whose file isn't here (deleted long ago, or another repo's) stay in the
  default namespace; the result reports how many (`leftInDefault`).
- Only within the current `migrationsCollection`.

::: warning Adopt one repo at a time
If two repos ever had a file with the same name, only one record exists, and whichever repo adopts
first takes it — the other then gets `MIGRATION_NAME_CONFLICT`. Read the dry run (`Executed By`,
`Service`) before adopting.
:::

## Options

| Option | Description |
|---|---|
| `--dry-run` | Preview which records would move, without writing anything. |
| `--no-lock` | Skip the concurrency lock (dev only). |
| `--json` | Emit `{ namespace, rows, adopted, leftInDefault, dryRun }` as JSON. |

Plus the [global flags](/guide/configuration#global-cli-flags). Requires a `namespace` in the config
(or `MMK_NAMESPACE`); without one it exits 1 with `INVALID_ARGUMENT`.

## Programmatic API

```ts
const result = await migrator.adopt({ dryRun: true }); // → AdoptResult
```
