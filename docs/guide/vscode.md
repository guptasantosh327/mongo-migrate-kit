---
title: mmk for VS Code
description: Create, run and roll back mongo-migrate-kit migrations from VS Code, compare your branch with staging and prod, and get a warning while you edit a migration that already ran.
---

# mmk for VS Code

**mmk for VS Code** puts your migrations in the editor: a sidebar of what's pending and applied,
run links above `up()` and `down()`, a comparison of your branch with staging and prod, and a
warning while you edit a migration that already ran.

It's a window onto the `mmk` command, not a second implementation. It runs **your project's own**
mongo-migrate-kit from `node_modules`, with your config file, your `.env` and your Node.js, and
shows what `mmk ... --json` returns. Whatever it shows, `npx mmk` says the same in a terminal.

## Install

Search for **mmk** in the Extensions view, or install it from the
[Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=guptasantosh327.mmk-vscode).
Cursor, Windsurf and VSCodium install it from
[Open VSX](https://open-vsx.org/extension/guptasantosh327/mmk-vscode).

It starts in any folder with an `mmk.config.js`, `.ts` or `.json`, or a `package.json` that depends
on `mongo-migrate-kit`. Monorepos and multi-root workspaces work: each project gets its own entry.
mongo-migrate-kit has to be installed in the project:

```bash
npm install mongo-migrate-kit mongodb
```

The extension only runs in trusted folders, because running mmk runs your project's config and
migrations.

## Working on your local database

`local` is your project's own setup: the connection your config file and `.env` give mmk, exactly as
in a terminal. On local you can:

- **Create a migration** with the `+` in the sidebar. It shows the file name mmk will create, and
  lets you pick JavaScript or TypeScript.
- **Run it** from the links above `up()` and `down()`: *Run up*, *Dry run*, *Redo*, *Run down*.
  Rolling back and redoing ask first.
- **See where you are** in the sidebar (pending, applied by batch, edited after it ran) and in the
  status bar.
- **Copy the CLI command** for any of these, to run it in a terminal instead.

Nothing runs on its own: every run is a click.

## Environments: staging and prod

Add the databases you deploy to with **mmk: Add environment…**. It asks for a name, the connection
string (typed into a masked box) and the database, tests the connection with `mmk status`, and
makes the environment **read-only** unless you say otherwise.

- The connection string is kept in your operating system's keychain. It reaches mmk as the `MMK_URI`
  and `MMK_DB` environment variables, which take priority over your config file and `.env`. It is
  never written to settings, logs or the command line.
- Your settings only hold the names, the read-only flags and the colors:

  ```json
  "mmk.environments": [
    { "name": "staging" },
    { "name": "prod" }
  ]
  ```

- On a read-only environment the extension only runs `status`, `list` and `dry-run`. That's
  enforced where commands run, not only hidden in the UI: deploys stay with your pipeline.
- The status bar turns amber on staging and red on anything named like prod.

**Compare all environments** shows every migration against every environment: applied (and when),
pending, edited after it ran, or applied but missing from your branch, with notes like
"On staging, not prod". It can compare the files on `origin/main` instead of your branch, which it
copies from git without touching your checkout.

### A read-only database user

For staging and prod, give the extension a user that can only read. From mongo-migrate-kit 1.6.0,
`status`, `list` and `dry-run` write nothing when they connect, so the `read` role is enough:

```js
// In the mongo shell, as an admin
use orders_prod
db.createUser({ user: 'mmk-reader', pwd: passwordPrompt(), roles: [{ role: 'read', db: 'orders_prod' }] })
```

With 1.5, every command creates the changelog index when it connects, so a read-only user gets
`CONNECTION_FAILED` with `not authorized` in the reason.

## Editing a migration that already ran

Changing a migration after it ran is the classic way to end up with databases that disagree. As
soon as you type in such a file, before you save, the extension warns on the changed lines and says
where it ran and what saving would do: `mmk down` will refuse to roll it back, `mmk status` will
mark it as changed, and nothing runs it again.

**Show applied version** finds the commit whose version of the file has the checksum mmk recorded
when it ran, and opens it next to your file. **Restore applied version** puts it back. Then write
the change as a new migration.

This needs mongo-migrate-kit 1.6.0 or later, whose `mmk status` reports the recorded checksum.

## Which mongo-migrate-kit version

| mongo-migrate-kit | What works |
| --- | --- |
| older than 1.5.0 | Nothing: the extension asks you to update. |
| 1.5.x | Local workflow, environments and the comparison (with a database user that can write). |
| 1.6.0 or later | Everything: also read-only database users and warnings while editing applied migrations. |

Update with `npm install --save-dev mongo-migrate-kit@latest`.

## Settings

| Setting | What it does |
| --- | --- |
| `mmk.environments` | Names, read-only flags and colors of your environments. Connection strings stay in the keychain. |
| `mmk.nodePath` | The Node.js that runs mmk. Empty means `node` from `PATH`, like your terminal. |

## Privacy

The extension sends no telemetry. It reaches your databases only through your own mmk, and sends
nothing anywhere else.
