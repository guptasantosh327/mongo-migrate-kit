---
title: mmk import
description: Copy an existing migrate-mongo changelog into mongo-migrate-kit with mmk import, so migrations that already ran are not run again. The source is never modified.
---

# mmk import

Copies the history from a [migrate-mongo](https://github.com/seppevs/migrate-mongo) `changelog`
collection into mmk, so mmk knows which migrations already ran. You do this once, when you switch.
The source collection is only read, never changed.

```bash
npx mmk import [options]
```

For the full walkthrough, see [Moving from migrate-mongo](/guide/migrate-mongo).

## Examples

```bash
npx mmk import --dry-run          # show what would be copied, write nothing
npx mmk import                    # copy it
npx mmk import --from old_log     # the source collection has another name
```

```text
$ npx mmk import
Loaded config from mmk.config.js
✔ Imported 3 record(s) from "changelog" → "_mmk_migrations"
┌─────────────────────────────────┬───────┬─────────────────────┬────────────┐
│ Migration                       │ Batch │ Applied At          │ Checksum   │
├─────────────────────────────────┼───────┼─────────────────────┼────────────┤
│ 20250301100000-create-users.js  │ 1     │ 2025-03-01 15:35:00 │ recomputed │
├─────────────────────────────────┼───────┼─────────────────────┼────────────┤
│ 20250412083000-add-sku-index.js │ 2     │ 2025-04-12 14:10:00 │ recomputed │
├─────────────────────────────────┼───────┼─────────────────────┼────────────┤
│ 20250720140000-split-address.js │ 3     │ 2025-07-20 19:40:00 │ recomputed │
└─────────────────────────────────┴───────┴─────────────────────┴────────────┘
```

## Options

| Option | Default | What it does |
| --- | --- | --- |
| `--from <collection>` | `changelog` | The migrate-mongo collection to read. |
| `--to <collection>` | your `migrationsCollection` | Where to write the records. |
| `--dry-run` | off | Show what would be imported, write nothing. |
| `--trust-hash` | off | Use migrate-mongo's stored `fileHash` without checking it against the file. |
| `--force` | off | Import even though the target already has records. |
| `--no-lock` | off | Don't take the lock. Only for local development. |
| `--json` | off | Print the result as JSON. |

`--from` and `--to` can't be the same collection.

## Checksums

The Checksum column says where each checksum came from:

1. If migrate-mongo stored a `fileHash` and it matches the file on disk (or you passed
   `--trust-hash`), that hash is reused.
2. Otherwise it's computed from the file now (`recomputed`).
3. If the file is gone, the checksum is left empty and you get a warning.

## If the target isn't empty

If mmk's history collection already has records, import stops with `IMPORT_TARGET_NOT_EMPTY`.
`--force` imports anyway, and the imported batches are numbered after the existing ones. Running a
forced import twice gives the same result both times.

## Imported records are forward-only

Imported records are marked `origin: 'migrate-mongo'`. Their files use migrate-mongo's
`up(db, client)` style, which mmk can't run safely, so [`mmk down`](/commands/down) and
[`mmk redo`](/commands/redo) refuse them before touching anything. Migrations you write afterwards
with `mmk create` roll back as normal.

## With a namespace

If several repos shared one migrate-mongo `changelog`, set a [`namespace`](/guide/shared-database)
in each repo and run `mmk import` in each:

- A repo only imports records whose file is in its own migrations folder. The others are listed as
  skipped (`notInRepo` in `--json`).
- Imported records get this repo's namespace.
- The "target isn't empty" check and the batch numbers only count this namespace, so other repos
  never get in the way.
