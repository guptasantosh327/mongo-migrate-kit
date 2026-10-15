---
title: mmk status and mmk list
description: See which MongoDB migrations have run, which are pending, and which files changed since they ran, with mmk status and mmk list. Includes the --check CI gate.
---

# mmk status and mmk list

Both show your migrations in a table. `status` shows everything. `list` can filter to pending or
applied only. Neither one writes anything or takes the lock.

## mmk status

```bash
npx mmk status [options]
```

```text
$ npx mmk status
Loaded config from mmk.config.js
┌─────────────────────────────────────────────┬─────────┬───────┬─────────────────────┬──────────┬────────────┐
│ Migration                                   │ Status  │ Batch │ Applied At          │ Checksum │ Author     │
├─────────────────────────────────────────────┼─────────┼───────┼─────────────────────┼──────────┼────────────┤
│ 20261012090000-add-users-email-index.js     │ applied │ 1     │ 2026-10-15 22:21:58 │ ok       │ Asha Rao   │
├─────────────────────────────────────────────┼─────────┼───────┼─────────────────────┼──────────┼────────────┤
│ 20261012091500-backfill-order-status.js     │ applied │ 1     │ 2026-10-15 22:21:59 │ ok       │ Asha Rao   │
├─────────────────────────────────────────────┼─────────┼───────┼─────────────────────┼──────────┼────────────┤
│ 20261014103000-add-orders-customer-index.js │ applied │ 2     │ 2026-10-15 22:21:59 │ ok       │ Ravi Kumar │
├─────────────────────────────────────────────┼─────────┼───────┼─────────────────────┼──────────┼────────────┤
│ 20261015110000-rename-user-name.js          │ pending │       │                     │ —        │            │
└─────────────────────────────────────────────┴─────────┴───────┴─────────────────────┴──────────┴────────────┘
```

### Reading the table

| Column | Meaning |
| --- | --- |
| Status | `applied` has run. `pending` hasn't. |
| Batch | Which `mmk up` run applied it. `mmk down` undoes the highest batch. |
| Applied At | When it ran, in your local time. |
| Checksum | `ok`: the file hasn't changed since it ran. `MISMATCH`: it has. `—`: not run yet. |
| Author | Who wrote it, from the file's `author` line at the time it ran. |

A `MISMATCH` means someone edited a migration after it ran. See
[Checksums](/guide/concepts#checksums) for why that matters and what to do.

With a [namespace](/guide/shared-database), the table starts with a `Namespace:` line and only lists
this repo's migrations. You may also see:

- **`unadopted`** in the Status column: the file ran before this repo had a namespace. It's applied,
  not pending. Run [`mmk namespace adopt`](/commands/namespace).
- **`(no file)`** after a name: there's a record but no file in your folder. The file was deleted,
  or the record belongs to another repo. Nothing is blocked.

### Options

| Option | What it does |
| --- | --- |
| `--check` | Exit with `1` if anything is pending. For CI. |
| `--json` | Print the rows as JSON on stdout. |
| `--all-namespaces` | Show every namespace's records, read-only. Can't be combined with `--check`. |

### Using it as a CI gate

`--check` prints the table as usual, then exits `1` if any migration is pending:

<Cast name="ci-check" alt="Terminal: mmk status --check prints the status table with one pending migration, then 1 pending migration(s), and the pipeline echoes Deploy blocked" />

```bash
npx mmk status --check || { echo "Run the migrations first"; exit 1; }
```

## mmk list

```bash
npx mmk list              # everything, like status
npx mmk list --pending    # only what hasn't run
npx mmk list --applied    # only what has run
```

| Option | What it does |
| --- | --- |
| `--pending` | Only pending migrations. |
| `--applied` | Only applied migrations. |
| `--json` | Print the rows as JSON. |

`npx mmk list --pending --json | jq length` is a quick way to count pending migrations in a script.

With a namespace whose older records haven't been adopted yet, `--pending` and `--applied` refuse
with `NAMESPACE_UNADOPTED` rather than give a wrong answer.
