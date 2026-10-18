---
title: mmk lock
description: See who holds the MongoDB migration lock with mmk lock, and whether it has gone stale, without taking or releasing it. Works with a read-only database user.
---

# mmk lock

Shows who holds the migration lock right now. It changes nothing.

```bash
npx mmk lock [--json]
```

## When you need it

Every `mmk up`, `down`, `redo`, `import` and `namespace adopt` takes a lock first, so two runs can't
overlap. When a run fails with `LOCK_ALREADY_HELD`, or before you start one, `mmk lock` tells you who
has it: the host, the process and the user, since when, and when it frees itself.

It never takes, renews or releases the lock, and it connects without writing anything, so it's safe
to run at any time, on any database, with a user that has only the `read` role.

## What it looks like

```text
$ npx mmk lock
Lock held by namespace "orders-worker": pid 48213 on deploy-runner-7 (ci) since 2026-06-05 12:01:33
If the holder crashed, the lock frees itself at 2026-06-05 12:03:03; `mmk unlock` releases it now (check the holder first)
```

If nobody holds it:

```text
$ npx mmk lock
No migration lock is currently held
```

A run that was killed leaves its lock behind until the lock goes stale. Once it has, mmk says so,
and you don't need [`mmk unlock`](/commands/unlock): the next run takes it over.

```text
$ npx mmk lock
Lock left by namespace "orders-worker": pid 48213 on deploy-runner-7 (ci) since 2026-06-05 12:01:33
It has gone stale (the holder stopped renewing it), so the next run takes it over
```

On a database that several repos share, the holder might be **another repo**. mmk says so, the way
`mmk unlock` does.

## Options

| Option | What it does |
| --- | --- |
| `--json` | Print `{ "holder": …, "stale": … }`. |

The [global flags](/guide/configuration#command-line-flags) work here too.

```json
{
  "holder": {
    "lockedAt": "2026-06-05T12:02:03.000Z",
    "pid": 48213,
    "host": "deploy-runner-7",
    "executedBy": "ci",
    "namespace": "orders-worker",
    "acquiredAt": "2026-06-05T12:01:33.000Z",
    "expiresAt": "2026-06-05T12:03:03.000Z"
  },
  "stale": false
}
```

`holder` is `null` when no lock is held, and then `stale` is `false`. `stale` is judged on the
database server's clock, by the same rule a run uses to take a lock over. `lockedAt` moves forward
each time the holder renews the lock; `acquiredAt` is when it first took it. `namespace`,
`acquiredAt` and `expiresAt` are there for holders running mongo-migrate-kit 1.5 or newer.

## From code

```ts
const { holder, stale } = await migrator.lockStatus(); // LockStatus, changes nothing
```
