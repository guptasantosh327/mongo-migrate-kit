# CI/CD &amp; Deployment

`mmk` is built for automation: `--json` gives machine-readable output on every data command, and
`mmk status --check` exits non-zero when migrations are pending. Here are the recipes that tie it
together.

## Run migrations on deploy

The simplest and most common pattern — apply pending migrations as a step in your deploy, before the
app starts:

```bash
mmk up
```

If it exits non-zero, fail the deploy. The [lock](/guide/concepts#safety-mechanisms) guarantees that
even if two deploy jobs race, only one runs migrations.

## Gate a deploy on a fully-migrated database

Use `--check` to refuse to proceed when migrations are pending:

```bash
mmk status --check || {
  echo "Database has pending migrations — blocking deploy"
  exit 1
}
```

## GitHub Actions

```yaml
# .github/workflows/migrate.yml
name: Migrate
on:
  push:
    branches: [main]

jobs:
  migrate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm ci
      - run: npx mmk up
        env:
          MMK_URI: ${{ secrets.MONGO_URI }}
          MMK_DB: ${{ secrets.MONGO_DB }}
```

Everything is driven by env vars, so no config file or secrets need to live in the repo.

## Docker

In a containerized deploy, run migrations as an init step. Note the host is usually the service name
(`mongo`), not `localhost`:

```dockerfile
# entrypoint.sh
#!/bin/sh
set -e
npx mmk up          # apply pending migrations, abort on failure
exec node server.js  # then start the app
```

```bash
docker run --rm \
  -e MMK_URI="mongodb://mongo:27017" \
  -e MMK_DB="my_app" \
  my-app npx mmk up
```

## Consuming JSON output

Every data command accepts `--json` and prints a single JSON document to **stdout** (human logs and
the spinner go to stderr, so stdout stays clean to pipe):

```bash
mmk up --json | jq '.[] | select(.status == "error")'
```

```bash
# Count pending migrations from a script
pending=$(mmk list --pending --json | jq 'length')
echo "$pending migrations pending"
```

On failure, the command prints `{ "error": { "code": "...", "message": "..." } }` and exits 1.

## Loading the connection from a secret manager

Don't want connection strings in env vars? A function config can fetch them at runtime — no cloud
SDKs are bundled, you bring your own:

```bash
mmk init --secret-provider   # generates an AWS Secrets Manager template (swap for any provider)
```

See [Configuration → async/factory config](/guide/configuration#async-factory-config-secret-managers).

## Tips

- Pin a Node version in CI that can run your migrations (≥ 18; ≥ 22.18 if you run `.ts` without `tsx`).
- Run `mmk dry-run up` in a pre-deploy check to log exactly what *would* run.
- If a job is killed mid-run and leaves a lock, `mmk unlock --yes` clears it in the next job.
