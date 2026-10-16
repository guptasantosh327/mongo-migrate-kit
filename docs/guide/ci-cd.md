---
title: Deploying and CI
description: Run MongoDB migrations with mongo-migrate-kit in a deploy pipeline, block deploys while migrations are pending, test every migration in CI, and read the JSON output.
---

# Deploying and CI

<p class="page-meta">Step 3 of the learning path · about 10 minutes</p>

mmk is a normal command that exits `0` when everything worked and `1` when it didn't, so it fits into
any pipeline. This page covers the setups people use most.

## Where should migrations run?

There are two common places, and either is fine:

- **A deploy step, before the new version starts.** The pipeline runs `mmk up`. If it fails, the
  deploy stops and the old version keeps running. This is the easiest to reason about.
- **When the app starts.** The app calls `runMigrations()` before it starts listening. Handy for
  serverless and small apps with no pipeline. See [Running from your code](/guide/api).

Whichever you choose, the [lock](/guide/concepts#the-lock) makes sure only one run happens at a time,
even if two deploys or ten app instances start together.

## Run migrations as a deploy step

```bash
npx mmk up
```

That's the whole step. Use environment variables for the connection, so no secrets sit in your repo:

```bash
MMK_URI="$MONGO_URL" MMK_DB=shop npx mmk up
```

## Block a deploy while migrations are pending

If migrations run somewhere else (a separate job, or by hand) and you want the app deploy to refuse
to go ahead until they've run, use `status --check`. It exits `1` when anything is pending:

<Cast name="ci-check" alt="Terminal titled CI deploy job: mmk status --check prints the status table with one pending migration, then 1 pending migration(s) in red, and the pipeline echoes Deploy blocked" />

```bash
npx mmk status --check || { echo "Run the migrations first"; exit 1; }
```

## GitHub Actions

A deploy job that runs migrations on every push to `main`:

```yaml
# .github/workflows/deploy.yml
name: Deploy
on:
  push:
    branches: [main]

jobs:
  migrate:
    runs-on: ubuntu-latest
    env:
      MMK_URI: ${{ secrets.MONGO_URL }}
      MMK_DB: shop
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm ci
      - run: npx mmk dry-run up      # writes the plan into the job log
      - run: npx mmk up

  deploy:
    needs: migrate                  # only deploys if the migrations worked
    runs-on: ubuntu-latest
    steps:
      - run: echo "deploy the app here"
```

The `dry-run` step changes nothing. It's there so the job log shows what was about to run, which
helps a lot when you look back at a deploy weeks later.

## Test every migration on pull requests

It's worth checking that each migration can run from scratch and roll back, before it gets anywhere
near production. A MongoDB service container makes this cheap:

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

This catches the most common mistakes: a typo in `down`, an index name that doesn't match, a
migration that only works on a database that already has some data.

::: tip Transactions in CI
A plain `mongo` service container is a standalone server, and standalone servers don't support
transactions. If your migrations use `useTransaction`, start the container as a single-node replica
set, or run your tests with `mongodb-memory-server`'s `MongoMemoryReplSet`.
:::

## Docker

If your container runs migrations before it starts the app, put both in the entrypoint:

```sh
#!/bin/sh
# entrypoint.sh
set -e
npx mmk up          # stop here if a migration fails
exec node server.js
```

Inside Docker Compose or Kubernetes, the database host is usually the service name, not `localhost`:

```bash
docker run --rm \
  -e MMK_URI="mongodb://mongo:27017" \
  -e MMK_DB=shop \
  my-app npx mmk up
```

In Kubernetes, a Job (or a Helm pre-upgrade hook) that runs `npx mmk up` before the new pods roll
out works the same way as a pipeline step.

::: warning Production images and devDependencies
Many Dockerfiles run `npm ci --omit=dev`. If `mongo-migrate-kit` is only a devDependency, the image
has no `mmk`, and in a non-interactive shell `npx mmk` will try to download an unrelated package
that happens to be called `mmk`, with your database credentials in the environment. Put
`mongo-migrate-kit` in `dependencies` and run it through an npm script (`"migrate": "mmk up"`, then
`npm run migrate`), which never downloads anything.
:::

## Reading the output in scripts

Add `--json` to any command that reads or changes migrations and you get one JSON document on
stdout. Progress lines and the spinner move to stderr, and so does anything your own code prints
(a `console.log` in a migration, a hook or a config function), so stdout is safe to pipe:

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

A few one-liners with `jq`:

```bash
# how many migrations are pending?
npx mmk list --pending --json | jq length

# names of the files this run applied
npx mmk up --json | jq -r '.[] | select(.status == "applied") | .file'
```

When a command fails in JSON mode, it prints `{ "error": { "code": "...", "message": "..." } }` and
exits `1`. The `code` values are listed in [Error codes](/reference/error-codes).

When `up`, `down` or `redo` fails partway, `error.details.results` says what ran before it stopped,
in the same shape as a successful run. The file that failed comes last, with `"status": "error"`:

```bash
# which files did the failed run apply?
npx mmk up --json | jq -r '.error?.details.results[]? | select(.status == "applied") | .file'
```

## Tips

- **Use a Node version that can load your files.** Node 18 or newer for `.js`. For `.ts` without a
  loader, Node 22.18 or newer.
- **Log the plan.** `mmk dry-run up` before `mmk up` costs a second and makes the job log much more
  useful later.
- **Killed jobs can leave a lock behind.** It frees itself after `lockTTLSeconds` (60 by default).
  If you can't wait, `npx mmk unlock --yes` clears it. Only do that when you're sure nothing is
  running.

## Next

[Running from your code](/guide/api) shows `runMigrations()` for app start-up and serverless, and the
full API.
