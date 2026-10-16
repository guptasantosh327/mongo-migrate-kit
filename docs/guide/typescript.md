---
title: TypeScript
description: Write mongo-migrate-kit migrations and config in TypeScript. Which Node versions run .ts files, what syntax works, the types the package exports, a tsconfig that catches problems before they run, and production setups.
---

# TypeScript

<p class="page-meta">Step 2 of the learning path · about 8 minutes</p>

You can write migrations and the config file in TypeScript. mongo-migrate-kit ships its own types,
so the migration context, the config and everything the API returns are typed. There's no
`ts-node` or build step to set up.

mmk doesn't compile anything, though. It loads your `.ts` files with the Node you run it on. So the
one thing to get right is that **that Node can run TypeScript**, on your laptop and in production.

## Set it up

```bash
npx mmk init --ts                 # creates mmk.config.ts, with createExtension: 'ts'
npx mmk create add-users-index    # creates 20261016090000-add-users-index.ts
```

`createExtension: 'ts'` in the config makes every `mmk create` write a `.ts` file. `--js` still
gives you a `.js` file for a single migration, and the two can live side by side.

A new migration is written in your project's module style. mmk reads your `package.json` to decide:

::: code-group

```ts [ES module project]
// package.json has "type": "module"
import type { MigrationContext } from 'mongo-migrate-kit';

export const description = '';
export const author = 'Asha Rao';

export async function up({ db }: MigrationContext): Promise<void> {
  // TODO: implement migration
}

export async function down({ db }: MigrationContext): Promise<void> {
  // TODO: implement rollback
}
```

```ts [CommonJS project]
// package.json has "type": "commonjs", or no "type" (NestJS, most compiled TS apps)
import type { MigrationContext } from 'mongo-migrate-kit';

module.exports = {
  description: '',
  author: 'Asha Rao',

  async up({ db }: MigrationContext): Promise<void> {
    // TODO: implement migration
  },

  async down({ db }: MigrationContext): Promise<void> {
    // TODO: implement rollback
  },
};
```

:::

The CommonJS form looks unusual for TypeScript, but it's the one Node can run as it is.
`import type` disappears when Node removes the types, and what's left is plain CommonJS. The
familiar `export async function up` would need a compiler to become CommonJS. See
[ES modules or CommonJS](/guide/writing-migrations#es-modules-or-commonjs) for the full rule.

## Which Node runs it

| Node version | `.ts` migrations and `mmk.config.ts` |
| --- | --- |
| 22.18 or newer | Run as they are. Node removes the types before running the file. |
| 18, 20, and 22.0–22.17 | Need a loader. Install `tsx` and run mmk through it. |

To run mmk under `tsx`:

```bash
npm install -D tsx
```

```json
{
  "scripts": {
    "migrate": "node --import tsx node_modules/mongo-migrate-kit/dist/mmk.cjs up"
  }
}
```

Without either, mmk stops before running anything and says what to do. For a migration:

```text
✖ MIGRATION_INVALID_EXPORT: Cannot load TypeScript migration "20261016090000-add-users-index.ts" — this Node runtime cannot import .ts files. Use Node >= 22.18, run mmk under a TypeScript loader (e.g. tsx), or author the migration as .js.
```

And for the config file, naming the Node version that's actually running (often a surprise in CI):

```text
✖ CONFIG_INVALID: Config file mmk.config.ts is TypeScript, and this Node (v20.20.0) can't run TypeScript by itself
  Use Node 22.18 or newer, which runs .ts files directly
  Or run mmk under a TypeScript loader: node --import tsx node_modules/mongo-migrate-kit/dist/mmk.cjs <command>
  Or use a JavaScript config: mmk init --js
  File: /app/mmk.config.ts
```

## What TypeScript you can write

Node removes types; it doesn't compile. So TypeScript features that produce JavaScript code don't
work when Node runs the file itself:

| Doesn't work | Use instead |
| --- | --- |
| `enum Status { Active = 'active' }` | `const Status = { Active: 'active' } as const;` |
| `namespace Utils { … }` with code inside | a plain object, or a separate module |
| `constructor(private readonly db: Db)` | declare the field and assign it in the constructor |
| `import x = require('x')`, `export = x` | `import` / `export`, or `require()` / `module.exports` in CommonJS |

Using one stops the migration with Node's message:

```text
✖ TypeScript enum is not supported in strip-only mode
```

Two more rules come with it:

- **Relative imports need the real extension:** `import { inBatches } from './lib/batch.ts'`.
- **Type-only imports use `import type`**, as the generated files do.

Under `tsx` all of this works, because `tsx` compiles. That's a trap: a migration that runs under
`tsx` on your laptop can fail on a Node 22.18 production image that runs it without `tsx`. Stick to
the left-hand rules and the file runs everywhere. The tsconfig below checks them for you.

## Types you can use

Import any of these with `import type { … } from 'mongo-migrate-kit'`:

| Type | What it describes |
| --- | --- |
| `MigrationContext` | The argument to `up` and `down`: `db`, `client`, and `session` / `mongoose` when present |
| `MigrationModule` | A whole migration file: `up`, `down`, and the optional `useTransaction`, `description`, `author` |
| `MmkConfig` | Every setting. Config files use `Partial<MmkConfig>`, since every field is optional |
| `MmkConfigInput` | What a config file exports: an object, or a function (sync or async) that returns one |
| `MigrationHooks` | `beforeAll`, `afterAll`, `beforeEach`, `afterEach`, `onError` |
| `RunResult`, `StatusRow`, `MigrationSummary` | What `up()` / `down()`, `status()` and `runMigrations()` return |
| `MmkErrorCode` | The `code` on every mmk error (`'LOCK_ALREADY_HELD'`, …) |

The error classes (`MmkError`, `LockAlreadyHeldError`, …) are exported as classes, so
`error instanceof LockAlreadyHeldError` works too.

`session` is optional in `MigrationContext` because it's only there when the migration runs in a
transaction:

```ts
import type { MigrationContext } from 'mongo-migrate-kit';

export const useTransaction = true;

export async function up({ db, session }: MigrationContext): Promise<void> {
  await db.collection('plans').updateMany({}, { $set: { legacy: true } }, { session });
}

export async function down({ db, session }: MigrationContext): Promise<void> {
  await db.collection('plans').updateMany({}, { $unset: { legacy: '' } }, { session });
}
```

And a typed config with a hook. The hook's parameters are typed without annotations:

```ts
// mmk.config.ts
import type { MmkConfig } from 'mongo-migrate-kit';

const config: Partial<MmkConfig> = {
  dbName: 'shop',
  createExtension: 'ts',
  hooks: {
    async onError(name, error) {
      console.error(`${name} failed: ${error.message}`);
    },
  },
};

export default config; // module.exports = config; in a CommonJS project
```

## Type-check your migrations

Your app's `tsconfig.json` usually doesn't cover the migrations folder, or would compile it into
your build. Give migrations their own config that only checks:

```jsonc
// tsconfig.migrations.json
{
  "compilerOptions": {
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "target": "es2022",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "types": ["node"],
    "verbatimModuleSyntax": true,
    "erasableSyntaxOnly": true,
    "allowImportingTsExtensions": true
  },
  "include": ["mmk.config.ts", "migrations/**/*.ts"]
}
```

```bash
npx tsc -p tsconfig.migrations.json
```

Run it in CI next to your tests. With these settings, TypeScript flags exactly the files Node would
refuse to run:

- `"module": "nodenext"` reads your `package.json` for each file, as Node does.
- `"verbatimModuleSyntax"` flags `export` in a CommonJS project.
- `"erasableSyntaxOnly"` (TypeScript 5.8 or newer) flags `enum` and the rest of the table above.
- `"allowImportingTsExtensions"` allows `./lib/batch.ts` imports.
- `"types": ["node"]` provides `module.exports` and `process`, so install `@types/node`.

```text
migrations/20261016091500-add-status.ts(2,1): error TS1287: A top-level 'export' modifier cannot be used on value declarations in a CommonJS module when 'verbatimModuleSyntax' is enabled.
migrations/20261016092000-add-roles.ts(2,6): error TS1294: This syntax is not allowed when 'erasableSyntaxOnly' is enabled.
```

Every file `mmk init` and `mmk create` generate passes this check, in both ES module and CommonJS
projects.

## In production

**The production image has to run TypeScript too.** Either use Node 22.18 or newer in the image,
or install `tsx` as a regular dependency. Images built with `npm ci --omit=dev` drop
devDependencies, so a `tsx` in `devDependencies` works in CI and is missing in production.

**Compiling your app doesn't compile your migrations.** If your app runs as compiled JavaScript
(`node dist/main.js`) and calls `runMigrations()` on startup, mmk still loads the `.ts` files from
`migrationsDir` at that moment. The Node in production must be able to run them.

**Don't switch between `.ts` and compiled `.js` for the same database.** Some teams compile
migrations together with the app and point production at `dist/migrations`. That can work, but mmk
records each migration by its file name, extension included. A database migrated from
`add-index.ts` sees `add-index.js` as a new, pending migration and runs it again. Pick one form per
database and keep it. The simplest is to run the `.ts` files everywhere.

**Can't run TypeScript in production at all?** Write migrations as `.js` with a JSDoc type, even in
a TypeScript project. Your editor still gets the types:

```js
/** @param {import('mongo-migrate-kit').MigrationContext} ctx */
export async function up({ db }) {
  await db.collection('users').createIndex({ email: 1 }, { unique: true });
}
```

## Next

[A normal day with mmk](/guide/workflow) shows how these pieces fit into everyday work: writing a
migration, testing it, getting it reviewed and shipping it.
