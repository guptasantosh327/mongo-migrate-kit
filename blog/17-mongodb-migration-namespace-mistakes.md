<!--
SEO target keyword: "mongodb migration namespace mistakes"
Meta description: A changed namespace, a filename two repos both used, records nobody moved, a copied
config, an older tool against newer data. Five mistakes that would silently re-run or skip
migrations, and the exact messages mongo-migrate-kit stops you with instead.
Requires mongo-migrate-kit 1.5. Publish after 1.5.0 is on npm.
-->

# The namespace mistakes mongo-migrate-kit catches for you

A namespace decides which migrations count as applied. That's useful, and it also makes mistakes
with it dangerous. Get it wrong, and a migration tool will happily run every migration again, or
skip one that never ran.

mongo-migrate-kit 1.5 checks for the five mistakes I could think of that lead there. Four of them
stop the run before any migration runs. The fifth is a hint. Every message below is copied from a
real run.

## 1. The namespace changed (or has a typo)

Someone renames the repo and updates the namespace to match. Or types `order-api` instead of
`orders-api`. Either way, the new namespace has no history, so every migration looks pending.

mmk notices that the files it's about to run are already recorded under a *different* namespace:

```text
$ npx mmk up
Namespace: order-api
✖ MIGRATION_NAME_CONFLICT: These 3 files are recorded under namespace "orders-api", but this run uses "order-api"
  Did the namespace change? Changing it makes every migration look pending
  Files: 20261001090000-create-orders-indexes.js, 20261001093000-backfill-order-totals.js, 20261008110000-add-order-status-index.js
  If this repo's namespace is "orders-api", set it back in its config: namespace: 'orders-api'
  Nothing was run
```

**Fix:** set it back. A namespace is permanent. Treat it like a primary key, not a display name.

## 2. Two repos used the same file name

File names are unique within a history collection. If a file in your repo has the same name as one
another repo already applied (copied over, or a `0001-init.js` style name), mmk refuses instead of
skipping yours or overwriting theirs:

```text
$ npx mmk up
Namespace: orders-api
✖ MIGRATION_NAME_CONFLICT: "20261003120000-create-templates.js" is already used by namespace "notifications"
  This run uses namespace "orders-api"; filenames must be unique within a changelog collection
  Rename the file (e.g. recreate it with `mmk create`), or give this repo its own migrationsCollection
  Nothing was run
```

This counts records in any status. Even a record the other repo has since reverted still owns the
name.

**Fix:** rename the file (`mmk create` generates a fresh timestamp). If a repo needs `sequential`
names, give it its own `migrationsCollection`.

## 3. A namespace was added, but the old records weren't moved

A repo ran migrations without a namespace, then got one. Its old records have no namespace, so in the
new one they look pending. Run `up` and they'd run a second time:

```text
$ npx mmk up
Namespace: billing
✖ NAMESPACE_UNADOPTED: 2 migrations in this folder were applied before this repo had a namespace
  Their records have no namespace yet, so in namespace "billing" they would look pending (and `mmk up` would run them a second time)
  Files: 20260601090000-create-payments-indexes.js, 20260715090000-add-refund-status.js
  Preview the move:  mmk namespace adopt --dry-run
  Then move them:    mmk namespace adopt   (into "billing")
  Nothing was run
```

Every command that answers "what's applied?" refuses until you move them, including `dry-run`,
`list --pending` and `pendingMigrations()`, so a readiness check can't report work that isn't real.
`mmk status` keeps working and marks those rows `unadopted`.

**Fix:** `mmk namespace adopt --dry-run`, then `mmk namespace adopt`. Walkthrough:
[adding a namespace to a repo that already ran migrations](./15-add-namespace-existing-repo-migrations.md).

## 4. Applied records have no file here

This one doesn't block anything. It's a hint. If the history has applied migrations whose files
aren't in your folder, `mmk status` marks them `(no file)` and ends with one line:

```text
ℹ 2 applied migrations in namespace "orders-api" have no file here (deleted files, or another repo using the same namespace, e.g. a copied config)
```

The usual cause is harmless: old migration files were deleted. The dangerous cause is a **copied
config**: a new repo started from another repo's `mmk.config.js`, namespace and all. Two repos in one
namespace share a history, which is exactly what namespaces are there to prevent.

**Fix:** if you don't recognise the files, give this repo its own namespace (before its first
`up`, ideally).

Repos without a namespace see the same hint, worded for them, ending in `see "namespace"`. That's
the line that tells a single-repo user it's time to read about namespaces.

## 5. An older mongo-migrate-kit meets newer data

1.5 writes records that 1.4 can't read correctly: 1.4 ignores the `namespace` field and sees every
repo's records as its own. So that this can't happen again with future releases, 1.5 writes a small
marker into a `_mmk_meta` collection with the storage format it uses, and checks it every time it
connects.

So when a future version changes the format, a repo still on an older version refuses instead of
misreading:

```text
$ npx mmk status
✖ SCHEMA_TOO_NEW: This database was last used by mongo-migrate-kit 1.6.0, which stores data in a newer format
  Storage format in the database: 3; this version (1.5.0) understands up to 2
  Running an older version could misread migration history, so nothing was run
  Upgrade this repo's mongo-migrate-kit to the same or a newer version: npm install mongo-migrate-kit@latest
```

(Versions before 1.5 don't know about the marker, so they can't be protected this way. That's why
every repo on a shared database must be on 1.5 or newer.)

**Fix:** upgrade the repo.

## In short

| Mistake | What you see | Blocks? |
|---|---|---|
| Namespace changed or mistyped | `MIGRATION_NAME_CONFLICT`: "Did the namespace change?" | Yes |
| Two repos used the same file name | `MIGRATION_NAME_CONFLICT` naming the other namespace | Yes |
| Namespace added, old records not moved | `NAMESPACE_UNADOPTED` | Yes (`status` warns) |
| Records without files (deleted, or a copied config) | `ℹ` line at the end of `status` | No |
| Older version, newer data | `SCHEMA_TOO_NEW` | Yes |

Every blocking check runs before any migration runs or any history is written, and every message
ends with what to do next.

## Try it

```bash
npm install mongo-migrate-kit mongodb
npx mmk status
```

Docs: **https://mongo-migrate-kit.vercel.app/reference/error-codes** · npm and GitHub: **mongo-migrate-kit**.

---

### Related reading

- [Many repos, one MongoDB database](./10-mongodb-migrations-shared-database-many-repos.md): the
  overview of the series.
- [Adding a namespace to a repo that already ran migrations](./15-add-namespace-existing-repo-migrations.md):
  the fix for mistake 3, step by step.
