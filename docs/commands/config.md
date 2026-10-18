---
title: mmk config
description: Show the configuration mongo-migrate-kit resolved from flags, environment variables, the config file and defaults, and where each value came from. Never connects.
---

# mmk config

Shows the settings mmk will use, and where each one came from. It never connects to the database,
so it works before you have a connection string, and it's safe to run anywhere.

```bash
npx mmk config [--json]
```

## When you need it

Settings can come from four places, and the highest one wins: a command-line flag, an `MMK_*`
environment variable (including `.env`), the config file, or mmk's default. When a command uses a
value you didn't expect (the wrong database, a migrations folder you didn't mean), `mmk config`
tells you which layer set it.

## What it looks like

```text
$ npx mmk config
Loaded config from mmk.config.js
┌──────────────────────┬──────────────────────────────────────────┬──────────────────────┐
│ Setting              │ Value                                    │ From                 │
├──────────────────────┼──────────────────────────────────────────┼──────────────────────┤
│ config file          │ /home/you/billing-api/mmk.config.js      │                      │
│ uri                  │ mongodb://***:***@localhost:27017        │ environment variable │
│ dbName               │ orders_dev                               │ environment variable │
│ namespace            │ billing-api                              │ config file          │
│ migrationsDir        │ /home/you/billing-api/migrations         │ config file          │
│ fileExtensions       │ .ts, .js                                 │ default              │
│ createExtension      │ js                                       │ default              │
│ …                    │                                          │                      │
└──────────────────────┴──────────────────────────────────────────┴──────────────────────┘
```

Paths are absolute, resolved the way every other command resolves them. The connection string's
username and password are always hidden. A setting nobody set shows `(not set)`.

## Options

| Option | What it does |
| --- | --- |
| `--json` | Print the settings as one JSON document (see below). |

The [global flags](/guide/configuration#command-line-flags) work here too, and show up as
`CLI flag` in the "From" column.

## JSON output

```json
{
  "configFile": "/home/you/billing-api/mmk.config.js",
  "migrationsDir": "/home/you/billing-api/migrations",
  "fileExtensions": [".ts", ".js"],
  "createExtension": "js",
  "sequential": false,
  "migrationsCollection": "_mmk_migrations",
  "lockCollection": "_mmk_locks",
  "lockTTLSeconds": 60,
  "strict": false,
  "useTransaction": false,
  "requireAuthor": false,
  "namespace": "billing-api",
  "dbName": "orders_dev",
  "uri": "mongodb://***:***@localhost:27017",
  "sources": {
    "migrationsDir": "file",
    "namespace": "file",
    "uri": "env",
    "dbName": "env",
    "fileExtensions": "default"
  }
}
```

- `configFile`, `dbName` and `uri` are `null` when there isn't one. `namespace`, `author` and
  `templatePath` are left out when they aren't set.
- `sources` names the layer each setting came from: `flag`, `env`, `file` or `default`. Settings
  that only a JS/TS config file can hold (`hooks`, `mongoClientOptions`, `mongoose`) appear there
  when they're set, though their values aren't printed.
- A setting that's wrong gives the usual `CONFIG_INVALID` [error document](/reference/error-codes),
  with every problem listed in `details.issues`.

## From code

```ts
const summary = await migrator.describeConfig(); // ConfigSummary, never connects
```

`ConfigSummary` and `ConfigSource` are exported from the package.
