# Core Concepts

New to database migrations? This page explains the mental model `mongo-migrate-kit` is built on.
Five minutes here makes every other page click.

## What is a migration?

A **migration** is a small, versioned script that makes a single change to your database — add an
index, rename a field, backfill data — and knows how to undo that change.

You commit migrations alongside your code. When a teammate pulls your branch or a deploy runs, the
same change is applied to their database, in the same order, exactly once. No more "works on my
machine" schema drift.

Each migration has two halves:

- **`up`** — apply the change (create the index).
- **`down`** — revert it (drop the index).

## The changelog

`mmk` records every migration it has applied in a collection called `_mmk_migrations` (the
**changelog**). Before running, it reads this collection to know what's already done, so a migration
is never applied twice.

Each record stores an audit trail: when it ran, how long it took, its checksum, the environment, who
ran it, and its batch.

::: tip History is never deleted
Rolling a migration back doesn't remove its record — it sets the record's status to `reverted` and
stamps `revertedAt`. The full history is always preserved.
:::

## Pending vs. applied

At any moment, every migration file is in one of two states:

- **Pending** — the file exists on disk but isn't in the changelog yet.
- **Applied** — it's recorded in the changelog as run.

`mmk up` applies pending migrations; `mmk status` shows you the full picture.

## Ordering

Migrations run in **ascending filename order**. That's why files are prefixed with a timestamp
(`20260605143021-add-users-index.js`) — it guarantees a deterministic, chronological order across
your whole team. Never reorder or rename an applied migration.

## Batches

Every time you run `mmk up`, all the migrations that run together are tagged with the same **batch
number**. Batches are how rollbacks know what "the last thing I did" was:

- `mmk down` reverts the **whole last batch** (everything from the most recent `mmk up`).
- `mmk down --batch 3` reverts a **specific** batch.
- `mmk down --steps 2` ignores batches and reverts the **last 2 migrations** individually.
- `mmk up --step` puts **each** file in its own batch, so you can peel them off one at a time later.

Think of a batch as "one deploy's worth of migrations."

## Safety mechanisms

Two things protect you from common production mistakes:

- **Lock** — before writing, `mmk` acquires an atomic lock in MongoDB so two deploys can't run
  migrations at the same time. It auto-expires and renews while a long migration runs. See
  [`mmk unlock`](/commands/unlock).
- **Checksum** — `mmk` stores a SHA-256 hash of each file when it runs. If a file is edited *after*
  it was applied, `mmk status` flags it as a mismatch, and `--strict` mode will refuse to continue —
  catching accidental edits to history.

## Putting it together

A typical run looks like this:

```
mmk up
  ├─ acquire lock
  ├─ read changelog → find pending files
  ├─ for each pending file (in order):
  │    ├─ verify checksum
  │    ├─ run up()
  │    └─ record it in the changelog (batch N)
  └─ release lock
```

Ready to do it for real? → [Tutorial](/guide/tutorial)
