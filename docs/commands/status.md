# mmk status &amp; mmk list

Inspect the state of every migration.

## mmk status

Render a full status table of all known migrations — applied and pending.

```bash
mmk status [options]
```

```
┌─────────────────────────────────────────┬─────────┬───────┬─────────────────────┬──────────┬──────────┬──────────────────────┐
│ Migration                               │ Status  │ Batch │ Applied At          │ Duration │ Checksum │ Author               │
├─────────────────────────────────────────┼─────────┼───────┼─────────────────────┼──────────┼──────────┼──────────────────────┤
│ 20260605120000-add-users-index.js       │ applied │ 1     │ 2026-06-05 12:00:00 │ 42ms     │ ok       │ Jane <jane@acme.io>  │
│ 20260605120500-backfill-status.js       │ applied │ 1     │ 2026-06-05 12:05:00 │ 128ms    │ MISMATCH │ Raj <raj@acme.io>    │
│ 20260606093000-add-orders-collection.js │ pending │       │                     │          │ —        │                      │
└─────────────────────────────────────────┴─────────┴───────┴─────────────────────┴──────────┴──────────┴──────────────────────┘
```

The **Checksum** column shows `ok` when the file is unchanged since it was applied, `MISMATCH` when
it was edited, and `—` for pending files.

The **Author** column shows who wrote each applied migration, as recorded from the file's
[`author` export](/guide/writing-migrations#author) when it was applied. It is blank for pending
files and for migrations applied without an author (including ones adopted via `mmk import`).

### Options

| Option | Description |
|---|---|
| `--check` | Exit with code **1** if any migration is pending. Ideal for CI deploy gates. |
| `--json` | Emit the status rows as a JSON array on stdout. |

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
