<!--
SEO target keyword: "migrate-mongo shared changelog multiple services"
Meta description: Several repos shared one migrate-mongo changelog collection. Here's how to move each
of them to mongo-migrate-kit with its own namespace: only its own history, no mix-ups between repos,
and nothing in the old changelog touched.
Requires mongo-migrate-kit 1.5. Publish after 1.5.0 is on npm.
-->

# Leaving migrate-mongo when several repos shared its changelog

[Switching one repo from migrate-mongo](./02-switching-from-migrate-mongo-guide.md) is one command:
`mmk import` copies the history from migrate-mongo's `changelog` collection into mongo-migrate-kit's.

It gets more interesting when **several repos shared that changelog**. migrate-mongo has no idea
which record belongs to which repo. Everything sits in one `changelog` collection. Import all of
that into one repo and it claims every repo's history as its own.

mongo-migrate-kit 1.5 handles this per repo, using namespaces.

## The example

Two repos, `users-api` and `search-api`, both ran migrate-mongo against the `accounts` database.
Their shared `changelog`:

```js
{ fileName: '20250110090000-create-users.js',        appliedAt: ISODate('2025-01-10T09:01:00Z') }  // users-api
{ fileName: '20250205090000-create-search-index.js', appliedAt: ISODate('2025-02-05T09:01:00Z') }  // search-api
{ fileName: '20250301090000-add-email-index.js',     appliedAt: ISODate('2025-03-01T09:01:00Z') }  // users-api
```

Each repo installs mongo-migrate-kit 1.5 and sets its namespace **before importing**:

```js
// users-api/mmk.config.js
module.exports = { dbName: 'accounts', namespace: 'users-api' };
```

## Import: each repo takes only its own files

Preview first. mmk matches the changelog against the files in **this repo's** migrations folder:

```text
$ npx mmk import --dry-run
Namespace: users-api
⚠ Skipping 1 record(s) whose files are not in this repo — namespace "users-api" imports only its own migrations: 20250205090000-create-search-index.js
◎ Dry-run  Would import 2 record(s) from "changelog" → "_mmk_migrations"
┌───────────────────────────────────┬───────┬─────────────────────┬────────────┐
│ Migration                         │ Batch │ Applied At          │ Checksum   │
├───────────────────────────────────┼───────┼─────────────────────┼────────────┤
│ 20250110090000-create-users.js    │ 1     │ 2025-01-10 09:01:00 │ recomputed │
├───────────────────────────────────┼───────┼─────────────────────┼────────────┤
│ 20250301090000-add-email-index.js │ 2     │ 2025-03-01 09:01:00 │ recomputed │
└───────────────────────────────────┴───────┴─────────────────────┴────────────┘
```

`search-api`'s record is left alone, and the report names it. Run it for real with `npx mmk import`.

Then `search-api` does the same from its own repo, and gets only its own record:

```text
$ npx mmk import
Namespace: search-api
⚠ Skipping 2 record(s) whose files are not in this repo — namespace "search-api" imports only its own migrations: 20250110090000-create-users.js, 20250301090000-add-email-index.js
✔ Imported 1 record(s) from "changelog" → "_mmk_migrations"
```

Each repo now has exactly its own history:

```text
$ npx mmk status            # in users-api
Namespace: users-api
┌───────────────────────────────────┬─────────┬───────┬─────────────────────┬──────────┬────────┐
│ Migration                         │ Status  │ Batch │ Applied At          │ Checksum │ Author │
├───────────────────────────────────┼─────────┼───────┼─────────────────────┼──────────┼────────┤
│ 20250110090000-create-users.js    │ applied │ 1     │ 2025-01-10 09:01:00 │ ok       │        │
├───────────────────────────────────┼─────────┼───────┼─────────────────────┼──────────┼────────┤
│ 20250301090000-add-email-index.js │ applied │ 2     │ 2025-03-01 09:01:00 │ ok       │        │
└───────────────────────────────────┴─────────┴───────┴─────────────────────┴──────────┴────────┘
```

## What to know

**The order doesn't matter.** `search-api` imported into a collection that already held
`users-api`'s records, and didn't need `--force`. "Is the target empty?" is checked per namespace.
Batch numbers are per namespace too, so `search-api` starts at batch 1.

**The old changelog is never modified.** `mmk import` only reads it. If anything goes wrong, the
migrate-mongo history is exactly as you left it.

**Set the namespace before you import.** Import without one and the records land in the default
namespace, and you'd then need `mmk namespace adopt` to move them.

**Records whose file is gone stay behind.** A migrate-mongo record whose file was deleted from every
repo isn't imported anywhere, since no repo can show it's theirs. That's harmless: nothing needs to
run for it.

**Imported migrations are forward-only.** migrate-mongo files use `up(db, client)`, and
mongo-migrate-kit calls `up({ db, client })`. So mmk won't try to run the old files, and refuses to roll them back:

```text
$ npx mmk down
Namespace: users-api
✖ Cannot roll back 1 migrate-mongo-imported migration(s): 20250301090000-add-email-index.js
These were adopted via `mmk import` (forward-only). Their files use the positional migrate-mongo signature, which mmk cannot run. Revert them manually or re-author them in mmk format.
✖ MIGRATION_IRREVERSIBLE: Cannot roll back migrate-mongo-imported migration(s): 20250301090000-add-email-index.js
```

New migrations are written in mmk's format and can be rolled back normally.

**These repos are probably CommonJS.** migrate-mongo projects usually are. New migrations you create
with `mmk create` use `export` syntax, so read
[JS, TS, ESM or CommonJS](./23-typescript-commonjs-esm-mongodb-migrations.md) before you write the
first one.

## The checklist

1. Upgrade every repo on the database to mongo-migrate-kit 1.5 or newer.
2. In each repo: set `namespace` in the config file.
3. In each repo: `npx mmk import --dry-run`, read the "Skipping" line, then `npx mmk import`.
4. In each repo: `npx mmk status` should show only this repo's migrations, all `applied`.
5. Stop running migrate-mongo.

## Try it

```bash
npm install mongo-migrate-kit mongodb
npx mmk import --dry-run
```

Docs: **https://mongo-migrate-kit.vercel.app/guide/migrate-mongo** · npm and GitHub: **mongo-migrate-kit**.

---

### Related reading

- [Switching from migrate-mongo, step by step](./02-switching-from-migrate-mongo-guide.md): the
  single-repo version of this guide.
- [Many repos, one MongoDB database](./10-mongodb-migrations-shared-database-many-repos.md): why
  shared histories need namespaces.
