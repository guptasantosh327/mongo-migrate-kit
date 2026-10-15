<!--
SEO target keyword: "typescript mongodb migrations"
Meta description: JavaScript or TypeScript, ES modules or CommonJS: which migration files actually run
in production, on which Node versions, and the errors you'll see when the combination is wrong.
Works with mongo-migrate-kit 1.4 and newer. REVISE the CommonJS section if `mmk init`/`mmk create` start
generating CommonJS files for CommonJS projects.
-->

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
  **CommonJS** if it says `"type": "commonjs"`. With no `type` at all, newer Node versions guess
  from the syntax (and print a warning). Don't rely on that.
- A `.ts` file runs only if the Node running mmk can strip TypeScript types (**Node 22.18 or
  newer**), or if mmk runs under a TypeScript loader like `tsx`.

## ES modules and JavaScript: the default that just works

`mmk init` and `mmk create` generate this format by default:

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

With `"type": "module"` in `package.json`, this runs on every supported Node version, with no build
step and no loader. The JSDoc comments still give you autocomplete and type checking in your editor.
If you're not sure what to pick, pick this.

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
Cannot load TypeScript migration "20261015212454-add-users-index.ts" — this Node runtime cannot import .ts files. Use Node >= 22.18, run mmk under a TypeScript loader (e.g. tsx), or author the migration as .js.
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

This is the combination that needs care today. In a project with `"type": "commonjs"` (which recent
versions of `npm init -y` write by default, and what most older Express apps are), the files mmk
generates use `export`, which CommonJS can't load. The very first command after `mmk init` fails:

```text
$ npx mmk init && npx mmk create first
✔ Created  mmk.config.js
✖ CONFIG_INVALID: Config file /app/mmk.config.js could not be imported: Unexpected token 'export'
```

The fix takes two files. First, write the config with `module.exports`:

```js
// mmk.config.js
module.exports = {
  dbName: 'legacy',
  templatePath: './mmk-template.js',
};
```

Second, give `mmk create` a CommonJS template. Keep it **outside** `migrations/`, or mmk will treat
the template itself as a migration:

```js
// mmk-template.js
/** @param {import('mongo-migrate-kit').MigrationContext} ctx */
async function up({ db }) {
  // TODO: implement migration
}

/** @param {import('mongo-migrate-kit').MigrationContext} ctx */
async function down({ db }) {
  // TODO: implement rollback
}

module.exports = { description: '', up, down };
```

Now every new migration is CommonJS, and runs:

```text
$ npx mmk create add-users-index
✔ Created  20261015212507-add-users-index.js
$ npx mmk up
✔ Applied  20261015212507-add-users-index.js   [0ms]
```

Custom templates are copied as they are, so they don't get the `author` line mmk adds to its built-in
templates. If you use `requireAuthor`, add `author: 'Your Name'` to the exports by hand.

## Which should you choose?

| Your project | Migrations | Notes |
|---|---|---|
| ESM (`"type": "module"`) | `.js` | The default. Runs everywhere |
| TypeScript, Node 22.18+ in production | `.ts` | No `enum`, and `.ts` extensions in imports |
| TypeScript, older Node in production | `.js` with JSDoc, or `.ts` + `tsx` in `dependencies` | Check the production image, not your laptop |
| CommonJS | `.js` via a CommonJS template | `module.exports` config and `templatePath` |

Whatever you pick, **set `"type"` in `package.json` explicitly**, and test a migration in the same
image you deploy, not just on your machine.

## Try it

```bash
npm install mongo-migrate-kit mongodb
npx mmk init          # or --ts
```

Docs: **https://mongo-migrate-kit.vercel.app/guide/writing-migrations** · npm and GitHub: **mongo-migrate-kit**.

---

### Related reading

- [MongoDB migrations on Kubernetes](./22-mongodb-migrations-kubernetes-job-helm.md): the other
  half of the production-image trap.
- [Why I built a new MongoDB migration tool](./01-why-i-built-mongo-migrate-kit.md): the story
  behind mongo-migrate-kit.
