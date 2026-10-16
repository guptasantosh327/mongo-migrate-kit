<!--
SEO target keyword: "mongo-migrate-kit service namespace"
Meta description: mongo-migrate-kit 1.5 deprecates the service setting in favour of namespace. They
sound alike but do different things. Here's the difference, why service couldn't be fixed, and how
to switch safely.
Published copy: docs/blog/mongo-migrate-kit-service-vs-namespace.md (edit that one first, then run node scripts/blog-sync.mjs).
-->

# `service` is deprecated, use `namespace` (they're not the same)

mongo-migrate-kit 1.3 added a `service` field to migration records. 1.5 adds `namespace`. If you
share a database between repos, it's fair to ask: aren't these the same thing?

They're not, and the difference is why `service` is on its way out.

## What `service` did

`service` is a **label**. Every record `mmk up` writes gets the name of the codebase that applied it,
so that on a shared database you could at least *see* who ran what. You could set it explicitly, or
let mmk work it out: from npm's environment when started through an npm script, otherwise from the
nearest `package.json`.

But it only labels. `status` still shows every repo's migrations, `down` still undoes the newest
batch in the collection, and a file name one repo applied still counts as applied in another.

## What `namespace` does

`namespace` is **ownership**. Every query mmk makes is scoped to it: what's applied, what's pending,
which batch is last. Two repos with different namespaces have separate histories inside one
collection.

That's what people wanted from `service` all along.

## Why `service` couldn't just be upgraded

The obvious move would be to make `service` do what `namespace` does. Here's why that was ruled out.

**Its value depends on how mmk was started.** In a monorepo, run mmk through a script in the root
`package.json` and npm reports the *root* package's name; run it from the service folder and you get
the service's name; run the built CLI directly in a Docker image without a `package.json` and you
get nothing. That's fine for a label. It's dangerous for something that decides which migrations
count as applied. The same repo would see a different history depending on how it was started.

A namespace is the opposite: written by hand, once, in the config file, and never guessed.

## What changes in 1.5

**Nothing breaks.** `service` keeps working exactly as before, including the automatic detection.

If you set it **explicitly** (in the config file or with `MMK_SERVICE`), every run prints a notice:

```text
⚠ "service" (from the config file mmk.config.json) is deprecated and will be removed in 2.0. To separate repos sharing a database, use "namespace" — they are not the same: changing "namespace" changes which migrations count as applied
```

TypeScript users also see `service` struck through as `@deprecated`.

**In 2.0** (planned), `service` is removed. A config that still sets it will get a clear error
pointing to `namespace`, not a silent conversion, which would point you at an empty history.
**Existing records keep their `service` field.** mongo-migrate-kit never rewrites history.

## How to switch

Don't rename the key. This is the one thing to avoid:

```js
// ✗ don't: this is not a rename
export default { dbName: 'shop', namespace: 'orders-api' /* was: service: 'orders-api' */ };
```

…and stop there. Your existing records have a `service` label but no namespace, so in the new
`orders-api` namespace they don't exist yet. mmk notices and refuses to run (`NAMESPACE_UNADOPTED`),
so nothing runs twice. But the repo is stuck until you finish the switch.

The full switch:

1. Upgrade **every repo on the database** to 1.5 or newer.
2. Remove `service` from the config, and add `namespace`.
3. Move this repo's old records into the namespace:

   ```bash
   npx mmk namespace adopt --dry-run   # the Service column shows each record's old label
   npx mmk namespace adopt
   ```

The `Service` column in the dry run is where your old labels finally pay off: it shows which records
were written by which repo, so you can confirm you're only adopting your own.

## Do you even need to switch?

If you set `service` on a repo that has **its database to itself**, just delete the line. You don't
need a namespace. Namespaces are for shared databases.

If the database is shared, switch to `namespace`, or leave the repo that was there first without
one. Records without a namespace belong to the default namespace, which works alongside named ones.

## In short

`service` labelled records. `namespace` owns them. `service` keeps working in 1.5, prints a notice
if you set it explicitly, and goes away in 2.0. Switch by adding a namespace and running
`mmk namespace adopt`, never by renaming the key and walking away.

## Try it

```bash
npm install mongo-migrate-kit@latest
npx mmk namespace adopt --dry-run
```

More in the docs: [mmk namespace adopt](https://mongo-migrate-kit.vercel.app/commands/namespace). The package is on [npm](https://www.npmjs.com/package/mongo-migrate-kit) and
[GitHub](https://github.com/guptasantosh327/mongo-migrate-kit).

---

### Related reading

- [Adding a namespace to a repo that already ran migrations](./15-add-namespace-existing-repo-migrations.md):
  `adopt`, step by step.
- [Many repos, one MongoDB database](./10-mongodb-migrations-shared-database-many-repos.md): the
  overview of the series.
