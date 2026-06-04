# Lifecycle Hooks

Hooks let you run code around the migration lifecycle — logging, metrics, Slack notifications, cache
busting, and so on. Define them in your config under `hooks`.

::: warning Code-only option
Hooks are functions, so they can only live in a `.ts`/`.js` config — not in `mmk.config.json`.
:::

## The five hooks

```ts
import type { MigrationHooks } from 'mongo-migrate-kit';

export default {
  uri: 'mongodb://localhost:27017',
  dbName: 'my_app',
  hooks: {
    /** Runs once before any migration in the batch starts */
    beforeAll: async (ctx) => {
      console.log('Starting migration batch…');
    },
    /** Runs once after all migrations in the batch complete */
    afterAll: async (ctx) => {
      console.log('Batch complete.');
    },
    /** Runs before each individual migration */
    beforeEach: async (name, ctx) => {
      console.log(`→ ${name}`);
    },
    /** Runs after each migration completes successfully */
    afterEach: async (name, duration, ctx) => {
      console.log(`✓ ${name} (${duration}ms)`);
    },
    /** Runs when a migration throws — before the error propagates */
    onError: async (name, error, ctx) => {
      await notifySlack(`Migration ${name} failed: ${error.message}`);
    },
  } satisfies MigrationHooks,
};
```

## Signatures

| Hook | Signature | When it runs |
|---|---|---|
| `beforeAll` | `(ctx) => Promise<void>` | Once, before the first migration in the run |
| `afterAll` | `(ctx) => Promise<void>` | Once, after the last migration succeeds |
| `beforeEach` | `(name, ctx) => Promise<void>` | Before every individual migration |
| `afterEach` | `(name, duration, ctx) => Promise<void>` | After each migration succeeds |
| `onError` | `(name, error, ctx) => Promise<void>` | When a migration throws, before it propagates |

`ctx` is the same [`MigrationContext`](/guide/writing-migrations#the-migration-context) passed to
your migrations, so hooks have full database access.

## Execution order

For a run of two migrations `A` then `B`:

```
beforeAll
  beforeEach(A) → A.up() → afterEach(A)
  beforeEach(B) → B.up() → afterEach(B)
afterAll
```

If `A.up()` throws:

```
beforeAll
  beforeEach(A) → A.up() ✖ → onError(A)   ← batch stops here, B never runs
```

`afterAll` does **not** run when the batch stops on an error.
