<!--
SEO target keyword: "mongo-migrate-kit namespace do I need it"
Meta description: mongo-migrate-kit 1.5 adds namespaces for repos that share a MongoDB database. If
your repo has its database to itself, here's exactly what changes for you: nothing.
Requires mongo-migrate-kit 1.5. Publish after 1.5.0 is on npm.
-->

# One repo, one database? You can ignore namespaces

mongo-migrate-kit 1.5 adds **namespaces**, so several repos can share one MongoDB database without
seeing each other's migrations. If you read [the announcement](./10-mongodb-migrations-shared-database-many-repos.md),
you might be wondering whether you need to do anything.

If your repo is the only thing running migrations against its database: **no.** Here's what stays
the same, so you can upgrade without thinking about it.

## Your config stays the same

A single-repo config before 1.5:

```js
// mmk.config.js
export default {
  dbName: 'blog',
};
```

The same config after 1.5. There's no new required setting, and mmk never guesses a namespace for
you from your folder name or `package.json`.

## Your database stays the same

These are the collections in a single-repo database after running migrations with 1.5:

```text
_mmk_locks, _mmk_migrations
```

The same two as before. The records inside look exactly like 1.4's: no `namespace` field, no
rewrite of old records, nothing to migrate. 1.5 also has a small `_mmk_meta` collection, but it's
only created when a namespace is set, so you won't see it.

## Your output stays the same

```text
$ npx mmk up
Loaded config from mmk.config.js
✔ Applied  20261002100000-create-posts.js   [2ms]
✔ Applied  20261004100000-add-slug-index.js   [1ms]
```

Repos with a namespace get a `Namespace: orders-api` line at the top of each command. Yours doesn't.

## Where you'll see the word "namespace"

Two places, both harmless.

**In a fresh `mmk init` config**, as a commented-out setting:

```js
  /**
   * Scopes this repo's migration history when several repos share this database.
   * One value per repo, e.g. the repo name (lowercase letters, digits, . _ -).
   * Set it once and never change it — it decides which migrations count as applied.
   * Not needed when this repo has the database to itself.
   * Env: MMK_NAMESPACE
   */
  // namespace: 'my-repo',
```

Leave it commented out.

**At the bottom of `mmk status`, if some records have no file.** If the history has applied
migrations whose files aren't in your folder, `status` marks them `(no file)` and ends with one line:

```text
ℹ 2 applied migrations have no file here (deleted files, or a changelog shared with another repo — see "namespace")
```

Usually that just means someone deleted old migration files. Nothing is blocked, and you can ignore
it. But if you don't recognise those file names, another repo is probably writing to the same
database. That's your cue to come back to namespaces.

## When to come back

You'll want a namespace on the day a **second repo** starts running migrations against your
database. When that happens:

- The new repo sets its own `namespace` from its first run.
- **Your repo can stay exactly as it is.** Records without a namespace belong to the *default*
  namespace, and the default works fine next to named ones. Nothing forces you to move.
- If you'd rather follow the same naming rule as everyone else, set a namespace and move your old
  records into it once. See
  [adding a namespace to a repo that already ran migrations](./15-add-namespace-existing-repo-migrations.md).

## In short

Namespaces are for shared databases. If yours isn't shared, 1.5 is a normal upgrade: same config,
same collections, same records, same output.

## Try it

```bash
npm install mongo-migrate-kit@latest
npx mmk status
```

Docs: **https://mongo-migrate-kit.vercel.app** · npm and GitHub: **mongo-migrate-kit**.

---

### Related reading

- [Many repos, one MongoDB database](./10-mongodb-migrations-shared-database-many-repos.md), what
  namespaces are for and when you do need them.
- [Habits that make MongoDB migrations safe](./09-mongodb-migration-best-practices.md), which matter
  more than any setting.
