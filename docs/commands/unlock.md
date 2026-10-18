---
title: mmk unlock
description: Release a stuck MongoDB migration lock with mmk unlock after a crashed or cancelled deploy. Shows who holds the lock and asks before removing it.
---

# mmk unlock

Removes the migration lock by hand, for when a run crashed and left it behind.

```bash
npx mmk unlock [options]
```

## When you need it

Every `mmk up`, `down`, `redo`, `import` and `namespace adopt` takes a lock first, so two runs can't
overlap. Normally the lock is released when the run ends, even if it fails. But if the process is
killed outright (a cancelled CI job, an out-of-memory pod), it never gets the chance.

The lock frees itself after `lockTTLSeconds` (60 by default), so often you can just wait a minute.
`mmk unlock` is for when you can't wait. To only look, without releasing anything, use
[`mmk lock`](/commands/lock): it also says when a crashed run's lock has gone stale, so the next run
takes it over by itself.

## What it looks like

It shows who holds the lock and asks before removing it:

```text
$ npx mmk unlock
⚠ Lock held by namespace "orders-worker": pid 48213 on deploy-runner-7 (ci) since 2026-06-05T12:01:33.000Z
Force-release this lock? [y/N]
```

If nobody holds it:

```text
$ npx mmk unlock
No migration lock is currently held
```

On a database that several repos share, the holder might be **another repo**. mmk says so:

```text
⚠ This lock belongs to "billing-api", not this repo ("orders-api") — releasing it may let two migrations run at once
```

## Options

| Option | What it does |
| --- | --- |
| `--yes` | Don't ask, just release it. |
| `--json` | Print `{ "released": …, "holder": … }`. Doesn't ask. |

The [global flags](/guide/configuration#command-line-flags) work here too.

::: danger Check first
If the holder is still running, removing its lock lets a second run start alongside it. Before you
unlock, make sure the process named in the message has really stopped (the host and pid are there
for exactly that).
:::

## From code

```ts
const holder = await migrator.lockInfo();   // LockInfo | null, changes nothing (lockStatus() adds `stale`)
if (holder) {
  await migrator.forceUnlock();
}
```

`LockInfo` includes `namespace`, `acquiredAt` and `expiresAt` (when the lock frees itself if the
holder stops renewing it) for holders running 1.5 or newer.
