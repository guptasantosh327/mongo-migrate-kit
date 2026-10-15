---
title: Hooks
description: Run your own code before and after MongoDB migrations with mongo-migrate-kit hooks. beforeAll, afterAll, beforeEach, afterEach and onError, with examples.
---

# Hooks

<p class="page-meta">Step 3 of the learning path · about 4 minutes</p>

Hooks are functions mmk calls at fixed points during a run. People use them to post to Slack when a
migration fails, send timings to a metrics system, or clear a cache after the schema changes.

They go in your config file under `hooks`. Since they're functions, they only work in
`mmk.config.js` or `mmk.config.ts`, not in JSON.

## An example

```js
// mmk.config.js
export default {
  uri: process.env.MONGO_URL,
  dbName: 'shop',
  hooks: {
    async beforeAll() {
      console.log('Starting migrations');
    },
    async afterEach(name, duration) {
      metrics.timing('migration.duration', duration, { name });
    },
    async onError(name, error) {
      await postToSlack(`Migration ${name} failed: ${error.message}`);
    },
    async afterAll({ db }) {
      await db.collection('cache').deleteMany({});
    },
  },
};
```

## The five hooks

| Hook | Arguments | When |
| --- | --- | --- |
| `beforeAll` | `(ctx)` | Once, before the first migration of the run. |
| `beforeEach` | `(name, ctx)` | Before each migration. |
| `afterEach` | `(name, duration, ctx)` | After each migration that worked. `duration` is in ms. |
| `onError` | `(name, error, ctx)` | When a migration throws, before mmk stops and reports it. |
| `afterAll` | `(ctx)` | Once, after the last migration, if everything worked. |

`ctx` is the same [migration context](/guide/writing-migrations#what-you-get-in-the-context) your
migrations get, so hooks can read and write the database too.

Hooks don't run when there's nothing to do. If no migrations are pending, `mmk up` returns without
calling any of them.

## The order

A run with two migrations, A and B:

```text
beforeAll
  beforeEach(A)  →  A.up()  →  afterEach(A)
  beforeEach(B)  →  B.up()  →  afterEach(B)
afterAll
```

If A throws:

```text
beforeAll
  beforeEach(A)  →  A.up() ✖  →  onError(A)
                                 run stops here: B doesn't run, afterAll isn't called
```

So `afterAll` means "everything worked". If you need to clean up whether the run worked or not, do
it in both `afterAll` and `onError`.

## Mistakes mmk catches

A misspelled hook would never fire, and you'd never know. So mmk checks the names when it loads your
config: `beforeALL` is an error that asks "did you mean beforeAll?", and a hook that isn't a function
is an error too.

## Next

[When something goes wrong](/guide/troubleshooting) covers the errors you're most likely to meet,
what they mean, and how to fix them.
