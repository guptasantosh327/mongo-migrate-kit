<!--
SEO target keyword: "mongodb migrations multi tenant"
Meta description: Running the same MongoDB migrations across hundreds of tenant databases: a loop
with runMigrations(), limited parallelism, readable logs, one tenant's failure not blocking the rest,
and new tenants migrated on creation.
Works with mongo-migrate-kit 1.4 and newer. Can be published any time.
-->

# MongoDB migrations with a database per tenant

Multi-tenant SaaS apps on MongoDB often give each customer their own database: `tenant_acme`,
`tenant_globex`, and so on. It's good for isolation, backups, and deleting a customer cleanly.

It's less fun on deploy day, when one schema change has to reach five hundred databases. Most
migration tools are built around one connection string and one database. Here's how to do it with
mongo-migrate-kit. No special features needed.

## Each tenant database is independent

mongo-migrate-kit keeps its history (`_mmk_migrations`) and its lock (`_mmk_locks`) **inside the
database it migrates**. So every tenant database has its own history and its own lock:

- A tenant that was created last week and one from three years ago can be at different points, and
  each gets exactly the migrations it's missing.
- Two tenants can migrate at the same time, because they don't share a lock.
- You don't need namespaces. Namespaces are for several *repos* sharing one database; here it's one
  repo and many databases.

## The simple version: a loop

`runMigrations()` connects, runs everything pending, and disconnects, even if a migration throws.
Call it once per tenant:

```js
// scripts/migrate-tenants.mjs
import { runMigrations } from 'mongo-migrate-kit';

const tenants = await listTenants(); // from your control-plane database

const failed = [];
for (const tenant of tenants) {
  try {
    await runMigrations({ dbName: `tenant_${tenant.id}` });
  } catch (error) {
    failed.push(tenant.id);
    console.error(`Tenant ${tenant.id} failed:`, error.message);
  }
}

if (failed.length > 0) {
  console.error(`${failed.length} tenant(s) failed: ${failed.join(', ')}`);
  process.exit(1);
}
```

The connection string comes from `MMK_URI` and the migrations folder from your config file, as
usual. The only thing that changes per call is `dbName`.

Two decisions are built in:

- **One broken tenant doesn't stop the rest.** A tenant with odd data that fails a migration is
  noted and reported, and the other 499 still get migrated.
- **The script still fails.** It exits 1 at the end, so your pipeline goes red and someone looks at
  the failed tenants.

## Faster: a few tenants at a time

Five hundred tenants one after another can take a while. Run a small pool in parallel:

```js
import { runMigrations } from 'mongo-migrate-kit';

/** A logger that prefixes every line with the tenant, so parallel runs stay readable */
function tenantLogger(id) {
  const line = (msg) => console.log(`[${id}] ${msg}`);
  return { info: line, success: line, warn: line, error: line, dim: line };
}

async function migrateTenants(tenants, concurrency = 4) {
  const queue = [...tenants];
  const failed = [];

  async function worker() {
    for (let tenant = queue.shift(); tenant; tenant = queue.shift()) {
      try {
        await runMigrations({ dbName: `tenant_${tenant.id}`, logger: tenantLogger(tenant.id) });
      } catch (error) {
        failed.push({ tenant: tenant.id, error });
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, worker));
  return failed;
}
```

Output stays readable even with four tenants running at once:

```text
[acme] Nothing to migrate
[globex] Nothing to migrate
[initech] ✔ Applied  20261012090000-backfill-order-totals.js   [0ms]
[umbrella] ✔ Applied  20261012090000-backfill-order-totals.js   [0ms]
[hooli] ✔ Applied  20261012090000-backfill-order-totals.js   [0ms]
```

Keep the pool small. All tenants usually live on the same cluster, and each run opens its own
connection. Four or eight at a time is plenty. Heavy migrations (index builds, backfills) are a
reason to go *lower*, not higher.

## New tenants: migrate on creation

When a customer signs up, create their database and bring it up to date right away, in the same code
path:

```js
async function createTenant(id) {
  // ...create the tenant record, seed defaults...
  await runMigrations({ dbName: `tenant_${id}` });
}
```

A brand-new database has no history, so every migration runs, in order. The new tenant ends up
exactly where the old ones are.

## Checking where everyone is

`pendingMigrations()` answers "what hasn't run here yet?" without changing anything. It's useful for
a report before a deploy, or an admin page:

```js
import { pendingMigrations } from 'mongo-migrate-kit';

for (const tenant of tenants) {
  const pending = await pendingMigrations({ dbName: `tenant_${tenant.id}` });
  if (pending.length > 0) console.log(tenant.id, pending.map((row) => row.file));
}
```

## One tenant from the command line

For a single tenant (debugging, or running again after a fix) the CLI works as usual with `MMK_DB`:

```bash
MMK_DB=tenant_acme npx mmk status
MMK_DB=tenant_acme npx mmk up
```

## Write migrations for the oldest tenant you have

The hard part of multi-tenant migrations isn't the loop. It's the data. A tenant from three years
ago may have document shapes your newest tenants never had. Write migrations defensively (`$exists` checks,
no assumptions about optional fields), and run the loop against a copy of your oldest few tenants in
staging before production.

## In short

Each tenant database carries its own history and lock, so the whole job is a loop:
`runMigrations({ dbName })` per tenant, a small pool for speed, collect failures instead of stopping,
and migrate new tenants the moment they're created.

## Try it

```bash
npm install mongo-migrate-kit mongodb
MMK_DB=tenant_acme npx mmk status
```

Docs: **https://mongo-migrate-kit.vercel.app/guide/api** · npm and GitHub: **mongo-migrate-kit**.

---

### Related reading

- [Running MongoDB migrations on app start and in serverless](./07-run-migrations-on-startup-serverless.md):
  more on `runMigrations()` and `pendingMigrations()`.
- [Why I built a new MongoDB migration tool](./01-why-i-built-mongo-migrate-kit.md): the story
  behind mongo-migrate-kit.
