# mmk create &amp; mmk init

Author new migration files and generate a config.

## mmk create

Create a new, timestamped migration file with `up`/`down` stubs.

```bash
mmk create <name> [options]
```

```bash
mmk create add-users-index            # → 20260605143021-add-users-index.js
mmk create add-users-index --ts       # force a .ts file
mmk create add-users-index --js       # force a .js file
mmk create add-users-index --template ./my-template.ts
mmk create add-users-index --author "Jane Doe <jane@example.com>"
```

### File type resolution

The generated extension is resolved as: `--js` / `--ts` flag → `createExtension` config / env →
built-in default (`js`).

| Option | Description |
|---|---|
| `<name>` | Migration name; slugified into the filename after the timestamp prefix. |
| `--ts` | Generate a `.ts` migration (overrides config). |
| `--js` | Generate a `.js` migration (overrides config). |
| `--template <path>` | Use a custom template file instead of the built-in stub. |
| `--author <name>` | Author written into the file. Overrides the `author` config key. |
| `--json` | Emit the created file path as JSON. |

### Author

Every file from the built-in template starts with an `author` export:

```js
export const description = '';
export const author = 'Jane Doe <jane@example.com>';
```

The value is resolved in this order, first match wins:

1. `--author <name>`
2. the `author` config key / `MMK_AUTHOR`
3. git `user.name <user.email>` (either one alone if only one is set), read from the migrations directory
4. your OS username

If none is found, the line is written as `export const author = '';` for you to fill in. The
author is looked up **only here**, on your machine, and committed inside the file — `mmk up` reads
it from the file and never runs git. It is stored on the changelog record when the migration is
applied. See [Writing migrations](/guide/writing-migrations#author).

::: warning Custom templates
A `--template` file is copied verbatim, so the author is **not** injected. Add an
`export const author = '…';` line to your template yourself.
:::

::: tip
`mmk create` never connects to the database, so it needs no `uri`/`db`.
:::

## mmk init

Generate a fully-commented config file in the current directory.

```bash
mmk init [options]
```

```bash
mmk init                     # → mmk.config.js (default)
mmk init --ts                # → mmk.config.ts
mmk init --json              # → mmk.config.json
mmk init --secret-provider   # → a runtime secret-loading config (js/ts only)
mmk init --force             # overwrite an existing config file
mmk init --namespace orders-api   # write this repo's namespace (repos sharing a database)
```

### Options

| Option | Description |
|---|---|
| `--ts` | Create `mmk.config.ts`. |
| `--js` | Create `mmk.config.js` (the explicit default). |
| `--json` | Create `mmk.config.json` (omits code-only options like `hooks`). |
| `--secret-provider` | Generate a factory-function config wired to a secret manager (AWS example, provider-agnostic). `--json --secret-provider` is rejected. |
| `--force` | Overwrite an existing config file (otherwise exits 1 with `CONFIG_FILE_EXISTS`). |
| `--namespace <ns>` | Write `namespace: '<ns>'` into the file, for [repos sharing a database](/guide/shared-database). Without it the file has a commented-out example — the value is never guessed. An invalid value exits 1 with `INVALID_ARGUMENT`. |

The generated JS/TS templates document every option in its own `/** … */` block — what it does, its
default, and its env var or flag:

```js
  /**
   * Collection that records which migrations have run (the history).
   * Change it only to give a group of repos its own history on a shared database.
   * Default: '_mmk_migrations' · Env: MMK_COLLECTION
   */
  migrationsCollection: '_mmk_migrations',
```

Options that are off by default (`namespace`, `author`, `templatePath`, `hooks`) are left as
`// key: value` lines under their block, so one keystroke in your editor turns them on. The
`--uri` / `--db` / `--dir` global flags pre-fill the generated file.

See [Configuration](/guide/configuration) for what each option does.
