# mmk status &amp; mmk list

Inspect the state of every migration.

## mmk status

Render a full status table of all known migrations — applied and pending.

```bash
mmk status [options]
```

```
┌─────────────────────────────────────────┬─────────┬───────┬─────────────────────┬──────────┬──────────────────────┐
│ Migration                               │ Status  │ Batch │ Applied At          │ Checksum │ Author               │
├─────────────────────────────────────────┼─────────┼───────┼─────────────────────┼──────────┼──────────────────────┤
│ 20260605120000-add-users-index.js       │ applied │ 1     │ 2026-06-05 12:00:00 │ ok       │ Jane <jane@acme.io>  │
│ 20260605120500-backfill-status.js       │ applied │ 1     │ 2026-06-05 12:05:00 │ MISMATCH │ Raj <raj@acme.io>    │
│ 20260606093000-add-orders-collection.js │ pending │       │                     │ —        │                      │
└─────────────────────────────────────────┴─────────┴───────┴─────────────────────┴──────────┴──────────────────────┘
```

The **Checksum** column shows `ok` when the file is unchanged since it was applied, `MISMATCH` when
it was edited, and `—` for pending files.

The **Author** column shows who wrote each applied migration, as recorded from the file's
[`author` export](/guide/writing-migrations#author) when it was applied. It is blank for pending
files and for migrations applied without an author (including ones adopted via `mmk import`).

With a [`namespace`](/guide/shared-database), the table shows only this repo's migrations and starts
with a `Namespace: <name>` line. Two markers can appear:

- **`unadopted`** in the Status column — the file was applied before this repo had a namespace. It
  is applied, not pending; run [`mmk namespace adopt`](/commands/namespace).
- **`(no file)`** after a name — the changelog has a record but the file isn't in your migrations
  folder (deleted on purpose, or another repo's). The table then ends with one info line counting
  them. Nothing is blocked; `mmk up` never mentions it.

### Options

| Option | Description |
|---|---|
| `--check` | Exit with code **1** if any migration is pending (or `unadopted` — the message then says to run `mmk namespace adopt`). Ideal for CI deploy gates. |
| `--json` | Emit the status rows as a JSON array on stdout. |
| `--all-namespaces` | Read-only overview of **every** namespace in the changelog collection — raw records, including reverted ones, with a Namespace column (`(default)` for records without one). Can't be combined with `--check`. |

Plus the [global flags](/guide/configuration#global-cli-flags).

### CI deploy gate

```bash
mmk status --check || echo "Database has pending migrations — blocking deploy"
```

## mmk list

A filtered, simpler view.

```bash
mmk list --pending     # only migrations not yet applied
mmk list --applied     # only applied migrations
```

| Option | Description |
|---|---|
| `--pending` | Show only pending migrations. |
| `--applied` | Show only applied migrations. |
| `--json` | Emit the filtered rows as JSON. |

With a [namespace](/guide/shared-database) whose older records aren't adopted yet, `--pending` and
`--applied` refuse with `NAMESPACE_UNADOPTED` instead of reporting already-applied migrations as
pending. Plain `mmk list` and `mmk status` still show everything, with those rows marked `unadopted`.
