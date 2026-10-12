# Ideas — where mongo-migrate-kit might go next

> **This is not a roadmap.** Nothing here is promised, scheduled, or guaranteed to ship. These are
> directions being explored, shared early so you can see the thinking and say what would actually
> help you. Ideas may change shape, be merged, or be dropped entirely.

Have an opinion on any of these, or a pain point that isn't listed?
[Open an issue](https://github.com/guptasantosh327/mongo-migrate-kit/issues) — real use cases
are the single biggest factor in what gets explored further.

---

## Large data migrations that can resume

The most common MongoDB migration is a backfill over a large collection — too big for a
transaction, and painful to restart from zero if it fails halfway. The idea is a helper that
processes documents in chunks, saves a checkpoint as it goes, and continues from that checkpoint on
the next run, with progress output and optional pauses between chunks to go easy on production.

```js
// Exploratory sketch — not a real API
await ctx.batch('users', { status: { $exists: false } }, async (docs) => {
  /* update this chunk */
}, { size: 1000 });
```

## Noticing migrations that arrive "late"

A migration written on a long-lived branch can carry an older timestamp than migrations already
applied in production. The idea is to detect this and let you choose whether mmk should allow it,
warn about it, or refuse to continue.

## Before-deploy and after-deploy migrations

Zero-downtime changes (renaming a field, for example) often need some steps before the new code
ships and some after. The idea is to let a migration declare which phase it belongs to, so a
pipeline can run the "before" set, deploy, then run the "after" set.

## A linter for risky migrations

A command that reads migration files without running them and flags common mistakes — an empty
`down()`, an update or delete with an empty filter, a transactional migration that never passes its
`session`, an index created without a name — so they are caught in CI, not in production.

## Testing that a migration can be rolled back

A way to run `up → down → up` against a throwaway database and confirm the round trip works, both
as a command and as a helper for your own test suite. The goal: find a broken `down()` before you
need it.

## Other directions under consideration

- **Baseline / squash** — let a fresh environment start from a known point instead of replaying
  every historical migration.
- **Many databases at once** — run the same migrations across per-tenant databases.
- **Environment targeting** — mark a migration as only for certain environments, and ask for
  confirmation before touching protected ones.
- **Explicitly irreversible migrations** — declare that a migration cannot be rolled back, so
  `down` refuses clearly instead of doing nothing.
- **Index and validator drift** — compare the live database's indexes and validators against what
  your migrations expect.
- **Dependencies between migrations** — declare that one migration must run after another.
- **Integrations** — a GitHub Action, OpenTelemetry tracing, deploy notifications, a NestJS module,
  and a Docker image for init containers.

## Probably not

To be transparent about what is *unlikely*, and why:

- **A web dashboard** — `mmk status --json` already makes the data available to the tools you use.
- **Auto-generated `down()` functions** — reverting a data change can't be inferred reliably.
- **Schema-diff migration generation** — MongoDB has no fixed schema to diff against, so the
  output would be guesswork.

---

*Last updated: October 2026.* What has actually shipped is always in the
[changelog](./CHANGELOG.md).
