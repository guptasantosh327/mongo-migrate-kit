---
title: "MongoDB migrations in GitHub Actions"
description: "A practical GitHub Actions setup for MongoDB migrations: test every migration on pull requests, block deploys while migrations are pending, log the plan, and stay safe when two jobs overlap."
date: 2026-07-22
author: Santosh Gupta
---

# MongoDB migrations in GitHub Actions

Running migrations from your laptop works until a second person starts shipping. After that,
migrations belong in the pipeline: run the same way every time, logged, and safe when two jobs
overlap.

This is the setup I use with mongo-migrate-kit (`mmk`). It's made of four small pieces.

## 1. Test every migration on pull requests

The cheapest bugs to fix are the ones caught before merge. On every pull request, start an empty
MongoDB, run all migrations from scratch, roll the newest one back, and run it again:

```yaml
# .github/workflows/migrations.yml
name: Migrations
on: pull_request

jobs:
  up-down-up:
    runs-on: ubuntu-latest
    services:
      mongo:
        image: mongo:7
        ports: ['27017:27017']
    env:
      MMK_URI: mongodb://localhost:27017
      MMK_DB: ci_check
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm ci
      - run: npx mmk up              # everything applies on an empty database
      - run: npx mmk down --steps 1  # the newest migration rolls back
      - run: npx mmk up              # and applies again
```

This catches the usual mistakes: a typo in `down`, an index name that doesn't match, a migration that
only works on a database that already has data in it.

If your migrations use transactions, note that a plain `mongo` container is a standalone server,
which can't run them. Start it as a single-node replica set instead.

## 2. Log the plan, then migrate

On a merge to `main`, print what's about to run, then run it. `dry-run` writes nothing, and having
the plan in the job log is very useful when you look back at a deploy weeks later.

```yaml
# .github/workflows/deploy.yml
name: Deploy
on:
  push:
    branches: [main]

jobs:
  migrate:
    runs-on: ubuntu-latest
    concurrency: production-migrations   # don't start a second run while one is going
    env:
      MMK_URI: ${{ secrets.PROD_MONGO_URL }}
      MMK_DB: shop
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm ci
      - run: npx mmk dry-run up
      - run: npx mmk up

  deploy:
    needs: migrate        # the app only deploys if the migrations worked
    runs-on: ubuntu-latest
    steps:
      - run: echo "deploy the app here"
```

The connection comes from secrets through environment variables, so there's no config file and no
connection string in the repo.

## 3. Block a deploy that would run ahead of its migrations

If migrations run somewhere else (a separate job, a manual step), you can still make the app deploy
refuse to go ahead while anything is pending. `mmk status --check` exits `1` in that case:

<Cast name="ci-check" alt="Terminal titled CI deploy job: mmk status --check prints the status table with one pending migration, then 1 pending migration(s), and the pipeline echoes Deploy blocked" />

```yaml
      - name: Stop if migrations are pending
        run: npx mmk status --check
```

## 4. Two jobs at once are already handled

A retried job and a fresh merge can overlap. The `concurrency` setting above stops GitHub from
running two migrate jobs together, but it only knows about this one workflow. mmk's own lock lives
in the database, so it also covers another workflow, another repo, or someone running `up` by hand.
The second run stops and names whoever holds the lock. (How the lock works is in
[this post](./mongodb-migration-locking-concurrent-deploys).)

## Reading the output in a script

When a step needs to act on the result, add `--json`. You get one JSON document on stdout, and the
human-readable lines move to stderr:

```bash
npx mmk up --json
```

```json
[
  {
    "file": "20261012091500-backfill-order-status.js",
    "status": "applied",
    "duration": 265,
    "batch": 2
  }
]
```

On failure you get `{ "error": { "code": "...", "message": "..." } }` and exit code `1`, so a script
can check the code rather than search the text.

## Connection strings from a secret manager

If the connection string lives in AWS Secrets Manager, Google Secret Manager or Vault rather than a
GitHub secret, your `mmk.config.js` can export an async function that fetches it at runtime.
`npx mmk init --secret-provider` writes a starting point. See
[Configuration](/guide/configuration#loading-the-connection-string-from-a-secret-manager).

## The short version

```bash
npx mmk up && npx mmk down --steps 1 && npx mmk up   # on pull requests, against an empty database
npx mmk dry-run up                                   # on deploy: log the plan
npx mmk up                                           # then run it
npx mmk status --check                               # anywhere: fail if something is pending
```

## Try it

```bash
npm install mongo-migrate-kit mongodb
```

More pipeline examples (Docker, Kubernetes jobs) are on the
[Deploying and CI](/guide/ci-cd) page.

---

### Related reading

- [Locking MongoDB migrations so two deploys can't collide](./mongodb-migration-locking-concurrent-deploys)
- [Habits that make MongoDB migrations safe](./mongodb-migration-best-practices)
