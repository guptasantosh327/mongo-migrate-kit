---
title: "MongoDB migrations on Kubernetes: Job, Helm hook or init container?"
description: "Where should MongoDB migrations run on Kubernetes: a Job, a Helm hook, an init container, or the app itself? The trade-offs, working manifests, and the production-image problem that breaks most first attempts."
date: 2026-10-16
author: Santosh Gupta
order: 22
---

# MongoDB migrations on Kubernetes: Job, Helm hook or init container?

On a laptop, "run the migrations" means typing `mmk up`. On Kubernetes, someone has to decide
*which* process runs them, *when*, and what happens when ten pods start at once.

There are four common answers. One is the right default for most teams, and the others have their
place.

## Option 1: a Job before the rollout (recommended)

Run migrations once per release, as a Kubernetes Job, **before** the new pods roll out. With Helm,
that's a pre-install/pre-upgrade hook:

```yaml
# templates/migrate-job.yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: orders-api-migrate
  annotations:
    "helm.sh/hook": pre-install,pre-upgrade
    "helm.sh/hook-delete-policy": before-hook-creation   # keep the last run's logs
spec:
  backoffLimit: 3
  activeDeadlineSeconds: 1800
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: migrate
          image: "registry.example.com/orders-api:{{ .Values.image.tag }}"
          command: ["npm", "run", "migrate"]   # "migrate": "mmk up" in package.json
          envFrom:
            - secretRef:
                name: orders-api-mongo         # provides MMK_URI
```

Why this is the right default:

- **It runs exactly once per release**, not once per pod.
- **If it fails, the upgrade fails.** Helm stops before the new version rolls out, so new code never
  runs against an un-migrated database. The old version keeps serving.
- **It uses the same image** as the app, so the migration files always match the code.
- **The logs are in one place**: `kubectl logs job/orders-api-migrate`. The delete policy above
  keeps the Job until the next release replaces it; add `hook-succeeded` if you'd rather clean up
  successful runs immediately (and lose their logs).

`backoffLimit: 3` gives you retries for free. That matters when several services share a database:
they take turns on one migration lock, and a Job that finds it busy exits with
`LOCK_ALREADY_HELD`. Kubernetes retries it a few seconds later. A migration that really fails will
fail on every retry too, so keep the limit small.

Using Argo CD instead of Helm? The same Job with `argocd.argoproj.io/hook: PreSync` does the same
thing.

## Option 2: migrate in the app on startup

Every pod runs pending migrations before it starts serving, and the ones that lose the race wait:

```js
import { runMigrations } from 'mongo-migrate-kit';

await runMigrations({}, { onLockHeld: 'wait', lockWaitTimeoutMs: 10 * 60_000 });
app.listen(port);
```

One pod migrates. The others wait for the lock, then find nothing pending and start. This works well
when migrations are quick and you'd rather not maintain a separate Job.

The costs: every pod start (including scale-ups and node rotations) connects and checks. A slow
migration delays *every* pod's readiness, so give your readiness probe room. And set
`lockWaitTimeoutMs` above your longest migration (the default is 30 seconds). More in
[running migrations on app startup](./run-migrations-on-startup-serverless).

## Option 3: an init container (not recommended)

An init container runs before the app container on **every** pod:

```yaml
initContainers:
  - name: migrate
    image: "registry.example.com/orders-api:{{ .Values.image.tag }}"
    command: ["npm", "run", "migrate"]
```

It works, but with ten replicas, ten init containers start at once. One gets the lock. The other
nine fail immediately with `LOCK_ALREADY_HELD` (the CLI doesn't wait), and Kubernetes restarts them
with growing back-off delays. Your rollout is slower and your events are full of failures that
aren't really failures. If you want every pod involved, option 2 does the same job without the noise.

## Option 4: a step in the CI/CD pipeline

If your pipeline can reach the database, run `npx mmk up` as a deploy step before `helm upgrade` or
`kubectl apply`. Same benefits as option 1, outside the cluster. The trade-off is network access
from CI to the database, which many teams don't allow. The full setup is in
[MongoDB migrations in CI/CD](./mongodb-migrations-ci-cd-github-actions).

## The production-image problem

This is what breaks most first attempts: **production images often don't contain devDependencies.**

If `mongo-migrate-kit` is in `devDependencies` and your Dockerfile runs `npm ci --omit=dev`, the
image has no `mmk`. Worse, in a non-interactive shell `npx mmk up` doesn't stop there. It goes to the
npm registry and installs whatever package happens to be *called* `mmk` (an unrelated one), at
deploy time, with your database credentials in the environment. Two fixes:

- Put `mongo-migrate-kit` in **`dependencies`**. The migrations ship with the app, and so should the
  tool that runs them.
- Run it via an npm script (`npm run migrate`), which never downloads anything.

The same applies to TypeScript migrations: if they need `tsx` to run and `tsx` is a devDependency,
they'll fail in production. See [JS, TS, ESM or CommonJS](./typescript-commonjs-esm-mongodb-migrations).

## Write migrations the old pods can survive

With options 1 and 4, migrations run **before** the rollout, so for a few minutes the *old* pods run
against the *new* schema. With option 2, old and new pods overlap the same way. Either way, every
migration has to be safe for the version that's still running. That's the expand-and-contract
pattern: [zero-downtime schema changes](./zero-downtime-mongodb-schema-changes-expand-contract).

## In short

| Option | Runs | Use when |
|---|---|---|
| **Job / Helm pre-upgrade hook** | once per release, before rollout | the default |
| App startup + `onLockHeld: 'wait'` | in every pod, one at a time | migrations are fast; no Job wanted |
| Init container | in every pod, failing until the lock frees | avoid |
| CI/CD step | once per release, outside the cluster | CI can reach the database |

Whichever you choose: `mongo-migrate-kit` in `dependencies`, run through an npm script.

## Try it

```bash
npm install mongo-migrate-kit mongodb
npm pkg set scripts.migrate="mmk up"
```

More in the docs: [Deploying and CI](/guide/ci-cd). The package is on [npm](https://www.npmjs.com/package/mongo-migrate-kit) and
[GitHub](https://github.com/guptasantosh327/mongo-migrate-kit).

---

### Related reading

- [Running MongoDB migrations on app start and in serverless](./run-migrations-on-startup-serverless):
  option 2 in depth.
- [Locking MongoDB migrations so two deploys can't collide](./mongodb-migration-locking-concurrent-deploys):
  why ten pods can't run the same migration twice.
