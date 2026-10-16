---
title: mmk create and mmk init
description: Create a new MongoDB migration file with mmk create, and a commented config file with mmk init. File types, templates, authors and options.
---

# mmk create and mmk init

`mmk create` makes a new migration file. `mmk init` makes a config file. Neither one connects to the
database, so they work without a connection string.

## mmk create

```bash
npx mmk create <name> [options]
```

```text
$ npx mmk create add-users-email-index
Loaded config from mmk.config.js
✔ Created  20261015223650-add-users-email-index.js
```

The name gets a timestamp in front, so files sort in the order they were created. Spaces become
dashes: `npx mmk create "add users email index"` gives the same file name as above.

The new file matches your project's module style. It uses `export` if the nearest `package.json`
says `"type": "module"`, and `module.exports` otherwise:

::: code-group

```js [ES module]
export const description = '';
export const author = 'Asha Rao';

/** @param {import('mongo-migrate-kit').MigrationContext} ctx */
export async function up({ db }) {
  // TODO: implement migration
}

/** @param {import('mongo-migrate-kit').MigrationContext} ctx */
export async function down({ db }) {
  // TODO: implement rollback
}
```

```js [CommonJS]
module.exports = {
  description: '',
  author: 'Asha Rao',

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

:::

See [ES modules or CommonJS](/guide/writing-migrations#es-modules-or-commonjs) for the exact rule.

### Options

| Option | What it does |
| --- | --- |
| `<name>` | What the migration does. Becomes part of the file name. |
| `--ts` | Make a `.ts` file. |
| `--js` | Make a `.js` file. |
| `--template <path>` | Start from your own template file instead of the built-in one. |
| `--author <name>` | Put this in the `author` line. |
| `--json` | Print `{ "path": "..." }` instead of the usual line. |

### .js or .ts?

The flag wins if you give one. Otherwise mmk uses `createExtension` from your config (or
`MMK_CREATE_EXTENSION`). If neither is set, it makes `.js`, because `.js` runs on every supported Node
version with no setup. See [TypeScript](/guide/typescript).

### Where the author comes from

mmk uses the first of these it finds:

1. `--author "Name <email>"`
2. the `author` setting, or `MMK_AUTHOR`
3. your git `user.name <user.email>`, read in the migrations folder
4. your OS username

If it finds nothing, it writes an empty author (`author: ''`) for you to fill in. The author is
looked up once, here on your machine, and saved in the file. `mmk up` reads it from the file and
never runs git.

::: warning Custom templates
A `--template` file is copied exactly as it is: mmk doesn't add an author line or change its module
style. Write it in your project's style and put the author in it yourself
(`export const author = '…';` or `author: '…'` inside `module.exports`).
:::

## mmk init

```bash
npx mmk init [options]
```

```text
$ npx mmk init
✔ Created  mmk.config.js
```

Like `mmk create`, it matches your project: the config ends with `export default config;` when the
`package.json` in this folder (or above it) says `"type": "module"`, and `module.exports = config;`
otherwise. The same goes for `--ts` and `--secret-provider` configs.

The file has every setting in it, each with a comment saying what it does, its default, and its
environment variable or flag. Settings that are off by default are commented out, so turning one on
means deleting two characters. A sample:

```js
  /**
   * Database the migrations run against. Required.
   * Env: MMK_DB · Flag: --db
   */
  dbName: 'myapp',

  // ── Migration files ────────────────────────────────────────

  /**
   * Folder holding your migration files, relative to where you run mmk.
   * Default: './migrations' · Env: MMK_MIGRATIONS_DIR · Flag: --dir
   */
  migrationsDir: './migrations',
```

### Options

| Option | What it does |
| --- | --- |
| `--js` | Make `mmk.config.js`. This is the default. |
| `--ts` | Make `mmk.config.ts`. |
| `--json` | Make `mmk.config.json`. (Here `--json` means the file type, not JSON output.) |
| `--secret-provider` | Make a config that loads the connection from a secret manager at runtime. Has an AWS example you can swap for any provider. Not available with `--json`. |
| `--namespace <name>` | Write this repo's [namespace](/guide/shared-database) into the file. |
| `--force` | Replace an existing config file. Without it, mmk stops with `CONFIG_FILE_EXISTS`. |

The global flags fill in the file for you:

```bash
npx mmk init --uri mongodb://localhost:27017 --db shop --dir ./db/migrations
```

`--uri` can't contain a password, because config files usually get committed. mmk stops with
`INVALID_ARGUMENT` and writes nothing. Leave the password out of `--uri` and put the full URI in the
`MMK_URI` environment variable (or a `.env` file that git ignores), which overrides the file. Or use
`--secret-provider`, which reads the URI from a secret manager when mmk runs.

See [Configuration](/guide/configuration) for what each setting does.
