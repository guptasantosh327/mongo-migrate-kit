---
title: "MongoDB Migrations in CI/CD: A Practical GitHub Actions Setup"
description: "A practical setup for running MongoDB migrations in CI/CD — a pending-check gate, machine-readable JSON output, dry-run previews, and locking that survives concurrent pipeline runs."
date: 2026-07-22
author: Santosh Gupta
---

# MongoDB Migrations in CI/CD: A Practical GitHub Actions Setup

Running migrations from your laptop is fine until it isn't. The moment more than one person ships,
migrations belong in the pipeline — runnable the same way every time, gated, logged, and safe when
two jobs fire at once.

This is the setup I actually use, with **mongo-migrate-kit** (`mmk`). It's built for automation, so
none of this is duct tape.

## The three things CI needs that interactive tools forget

1. **A gate** — fail the build if code was merged that needs a migration nobody ran.
2. **Machine-readable output** — so a step can parse what happened, not scrape a pretty table.
3. **Safety under concurrency** — two pipeline runs must not race to migrate the same database.

`mmk` has a first-class answer to each.

## 1. The pending-migrations gate

You want CI to *fail loudly* if someone ships code that expects a migration that hasn't been applied.
`mmk status --check` exits non-zero when anything is pending:

```bash
mmk status --check    # exit 0 = up to date, exit 1 = something is pending
```

Drop that in a job that runs against staging (or a fresh test DB) and a "forgot to migrate" PR can't
go green. The human-readable "N pending" line goes to stderr, so it's visible in logs without
polluting any JSON you're capturing.

## 2. JSON output for every command

Pretty tables are for humans. Pipelines want structured data. Every DB-touching command takes
`--json` and emits one clean JSON document on stdout (logs and the spinner are routed to stderr, so
stdout stays a single parseable payload):

```bash
mmk up --json
# [{"file":"20260101-add-index.js","status":"applied","duration":42,"batch":4}, ...]

mmk status --json
# [{"file":"...","status":"applied","batch":3,"appliedAt":"...","checksumOk":true}, ...]
```

On failure it emits `{ "error": { "code": "...", "message": "..." } }` and exits 1 — so your step
can branch on the outcome instead of grepping. This is what makes it composable inside a pipeline.

## 3. Preview before you touch production

Before the production migration step runs, print the plan. `dry-run` writes nothing:

```bash
mmk dry-run up --json
```

Post that as a PR comment or a deploy-log line, and the exact set of migrations about to run against
production is reviewable *before* it happens — not discovered afterward.

## 4. Concurrency is already handled

Two pipeline runs overlapping (a retry, a fast-follow merge) would otherwise race to migrate the same
database. `mmk up` takes a MongoDB-native lock by default, so the second run fails fast with "lock
already held" instead of racing. You don't configure anything — it's on. (The
[locking deep-dive](./mongodb-migration-locking-concurrent-deploys) explains how it survives
crashed jobs and long migrations.)

## Putting it together: a GitHub Actions workflow

A two-stage shape that works well: **gate on every PR**, **migrate on deploy to main**.

```yaml
name: migrations

on:
  pull_request:
  push:
    branches: [main]

jobs:
  # On every PR: fail if the branch needs a migration that isn't applied to staging.
  check:
    if: github.event_name == 'pull_request'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm ci
      - name: Fail if migrations are pending
        run: npx mmk status --check
        env:
          MMK_URI: ${{ secrets.STAGING_MONGO_URI }}
          MMK_DB: ${{ secrets.STAGING_MONGO_DB }}

  # On merge to main: preview, then apply to production.
  migrate:
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    # concurrency group = belt and braces on top of the DB lock
    concurrency: production-migrations
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm ci
      - name: Preview the plan
        run: npx mmk dry-run up --json
        env:
          MMK_URI: ${{ secrets.PROD_MONGO_URI }}
          MMK_DB: ${{ secrets.PROD_MONGO_DB }}
      - name: Apply migrations
        run: npx mmk up --json
        env:
          MMK_URI: ${{ secrets.PROD_MONGO_URI }}
          MMK_DB: ${{ secrets.PROD_MONGO_DB }}
```

Connection details come from env vars (`MMK_URI`, `MMK_DB`) — **no config file is required**, which
is exactly what you want in CI where secrets live in the runner's environment, not the repo.

## Loading secrets at runtime

If your connection string lives in AWS Secrets Manager, GCP, or Vault rather than a plain env var,
your config file can `export default` an async function that fetches it at runtime — the library
ships no cloud SDKs, you bring your own inside the function. `mmk init --secret-provider` scaffolds
that for you. Handy when CI shouldn't see the raw URI at all.

## The shortlist

```bash
mmk status --check     # CI gate: exit 1 if anything is pending
mmk dry-run up --json  # preview the plan, write nothing
mmk up --json          # apply, structured output, locked by default
```

Predictable, gated, parseable, and safe when two jobs collide. That's all CI ever wanted from
migrations.

## Try it

```bash
npm install mongo-migrate-kit mongodb
```

Full CI/CD recipes (GitLab, CircleCI, secret managers) in the docs:
**https://mongo-migrate-kit.vercel.app** · npm/GitHub: **mongo-migrate-kit**.

---

### Related reading

- [Stop Concurrent Deploys From Corrupting Your Database](./mongodb-migration-locking-concurrent-deploys)
  — why two pipeline runs can't trample each other.
- [MongoDB Migration Best Practices](./mongodb-migration-best-practices) — the habits that keep
  a migration history trustworthy over years.
