---
title: "JS, TS, ESM or CommonJS: MongoDB migrations that actually run in production"
description: "JavaScript or TypeScript, ES modules or CommonJS: which migration files actually run in production, on which Node versions, and the errors you'll see when the combination is wrong."
date: 2026-10-16
author: Santosh Gupta
order: 23
---

# JS, TS, ESM or CommonJS: MongoDB migrations that actually run in production

Migration files are ordinary modules that the migration tool imports at runtime. That sounds
simple, until you notice the four ways a Node project can be set up (JavaScript or TypeScript, ES
modules or CommonJS) and that a file which runs fine on your laptop can fail in a production
container.

Here's how each combination behaves with mongo-migrate-kit, with the real errors, and what to
choose.

## How the files are loaded

mongo-migrate-kit loads each migration with Node's own `import()`. It doesn't bundle or compile
anything. So the rules are Node's rules:

- A `.js` file is an **ES module** if the nearest `package.json` says `"type": "module"`, and
  **CommonJS** otherwise: `"type": "commonjs"`, no `type` at all, or no `package.json`. (With no
  `type`, newer Node versions also guess from the syntax and print a warning. Older ones, Node 18
  included, don't guess.)
- A `.ts` file follows the same rule, and runs only if the Node running mmk can strip TypeScript
  types (**Node 22.18 or newer**), or if mmk runs under a TypeScript loader like `tsx`.

`mmk init` and `mmk create` read that same `package.json` before writing anything. You get an ES
module in a `"type": "module"` project and CommonJS everywhere else, so the file they write is
always one Node will load.

## ES modules and JavaScript

In a `"type": "module"` project, `mmk create` writes ES module syntax. Filled in, a migration looks
like this:

```js
/** @param {import('mongo-migrate-kit').MigrationContext} ctx */
export async function up({ db }) {
  await db.collection('users').createIndex({ email: 1 }, { unique: true });
}

/** @param {import('mongo-migrate-kit').MigrationContext} ctx */
export async function down({ db }) {
  await db.collection('users').dropIndex('email_1');
}
```

This runs on every supported Node version, with no build step and no loader. The JSDoc comments
still give you autocomplete and type checking in your editor. Starting a new project and not sure
what to pick? `npm pkg set type=module` and this is what you get.

## TypeScript

```bash
npx mmk init --ts     # mmk.config.ts, with createExtension: 'ts'
npx mmk create add-users-index
```

```ts
import type { MigrationContext } from 'mongo-migrate-kit';

export async function up({ db }: MigrationContext): Promise<void> {
  // ...
}

export async function down({ db }: MigrationContext): Promise<void> {
  // ...
}
```

**On Node 22.18 or newer**, this runs as-is. Node strips the types and runs the JavaScript. Two
limits come with that, because Node only *strips* types, it doesn't compile:

- No `enum`, no `namespace` blocks, no constructor parameter properties. Use one in a migration and
  you get:

  ```text
  ✖ TypeScript enum is not supported in strip-only mode
  ```

  Use a plain object (`const Status = { Active: 'active' } as const`) instead.
- Relative imports need the real extension: `import { helper } from './helpers.ts'`.

**On older Node**, mmk explains what's wrong instead of crashing with Node's internals:

```text
✖ MIGRATION_INVALID_EXPORT: Cannot load TypeScript migration "20261015212454-add-users-index.ts" — this Node runtime cannot import .ts files. Use Node >= 22.18, run mmk under a TypeScript loader (e.g. tsx), or author the migration as .js.
```

The fix is to run mmk under `tsx`:

```json
{
  "scripts": {
    "migrate": "node --import tsx node_modules/mongo-migrate-kit/dist/mmk.cjs up"
  }
}
```

### The production trap

TypeScript migrations that work in CI can still fail in production, because **production images
usually drop devDependencies**. If your migrations need `tsx` and `tsx` is a devDependency, the
production container can't run them.

Pick one:

- Run **Node 22.18 or newer** in the production image. No loader needed.
- Move `tsx` to `dependencies`.
- Write migrations in **`.js`** (with JSDoc types) even in a TypeScript project. Migrations rarely
  share much code with the app, and plain JavaScript makes the question go away.

## CommonJS

Most older Express apps are CommonJS, and so is every new `npm init -y` project: recent versions of
npm write `"type": "commonjs"`. mmk writes CommonJS there, and the first commands just work:

```text
$ npx mmk init
✔ Created  mmk.config.js
$ npx mmk create add-users-index
Loaded config from mmk.config.js
✔ Created  20261016020238-add-users-index.js
$ npx mmk up
Loaded config from mmk.config.js
✔ Applied  20261016020238-add-users-index.js   [0ms]
```

The config ends with `module.exports = config;`, and the migration looks like this:

```js
module.exports = {
  description: '',
  author: 'Priya <priya@shop.dev>',

  /** @param {import('mongo-migrate-kit').MigrationContext} ctx */
  async up({ db }) {
    // TODO: implement migration
  },

  /** @param {import('mongo-migrate-kit').MigrationContext} ctx */
  async down({ db }) {
    // TODO: implement rollback
  },
};
```

A project with no `type` field gets the same CommonJS files. That's Node's default, and it works on
every Node version without a warning.

### TypeScript in a CommonJS project

NestJS and most TypeScript backends that compile to CommonJS have no `type` field. There,
`mmk create --ts` writes:

```ts
import type { MigrationContext } from 'mongo-migrate-kit';

module.exports = {
  description: '',
  author: 'Priya <priya@shop.dev>',

  async up({ db }: MigrationContext): Promise<void> {
    // TODO: implement migration
  },

  async down({ db }: MigrationContext): Promise<void> {
    // TODO: implement rollback
  },
};
```

It looks unusual for TypeScript, but there's a reason. `import type` disappears when Node strips the
types, so what's left is plain CommonJS. The more familiar `export async function up` would need a
compiler to turn it into CommonJS, and Node's type stripping doesn't compile. This form runs under
Node 22.18+ on its own, runs under `tsx`, and type-checks with `@types/node`, even with
`verbatimModuleSyntax` on.

### A file in the wrong style

Copy a migration from an ES module project into a CommonJS one, or change your `package.json`'s
`type` after migrations have run, and Node refuses to load it. mmk says why, and how to fix it:

```text
✖ MIGRATION_INVALID_EXPORT: Migration "20260101000000-old-esm.js" uses ES module syntax (export/import), but Node loads it as CommonJS
  Why: /app/package.json has "type": "commonjs"
  Fix: write it as module.exports = { async up(ctx) {…}, async down(ctx) {…} }, the form `mmk create` uses here
  Or, to keep the file unchanged (rewriting an applied migration changes its checksum): add a package.json containing { "type": "module" } to /app/migrations
```

For a migration that has already run, take the second option. Rewriting it changes its checksum,
so `mmk status` flags it and `mmk down` refuses it. A one-line `package.json` in the migrations
folder sets that folder's style without touching any file, and `mmk create` follows it from then on.

## Which should you choose?

| Your project | Migrations | Notes |
|---|---|---|
| ESM (`"type": "module"`) | `.js` | ES module syntax. Runs everywhere |
| CommonJS, or no `type` | `.js` | CommonJS syntax. Runs everywhere |
| TypeScript, Node 22.18+ in production | `.ts` | No `enum`, and `.ts` extensions in imports |
| TypeScript, older Node in production | `.js` with JSDoc, or `.ts` + `tsx` in `dependencies` | Check the production image, not your laptop |

You don't pick the module style yourself: mmk reads it from `package.json`. Just test a migration in
the same image you deploy, not only on your machine.

## Try it

```bash
npm install mongo-migrate-kit mongodb
npx mmk init          # or --ts
```

More in the docs: [TypeScript](/guide/typescript) and
[ES modules or CommonJS](/guide/writing-migrations#es-modules-or-commonjs). The package is on [npm](https://www.npmjs.com/package/mongo-migrate-kit) and
[GitHub](https://github.com/guptasantosh327/mongo-migrate-kit).

---

### Related reading

- [MongoDB migrations on Kubernetes](./mongodb-migrations-kubernetes-job-helm): the other
  half of the production-image trap.
- [Why I built a new MongoDB migration tool](./why-i-built-mongo-migrate-kit): the story
  behind mongo-migrate-kit.
