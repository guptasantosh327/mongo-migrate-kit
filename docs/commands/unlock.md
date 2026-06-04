# mmk unlock

Force-release a stuck concurrency lock left behind by a crashed migration run.

```bash
mmk unlock [options]
```

## Why it exists

Every write command acquires an atomic MongoDB lock (in the `_mmk_locks` collection) so two deploys
can't run migrations at once. The lock auto-expires after `lockTTLSeconds` and renews on a heartbeat
while a migration runs. But if a process is killed mid-run, a lock can linger until its TTL elapses —
`mmk unlock` clears it immediately.

## Usage

```bash
mmk unlock          # show the current holder, then prompt for confirmation
mmk unlock --yes    # force-release without prompting
mmk unlock --json   # machine-readable { released, holder }
```

It first shows who holds the lock:

```
Lock held by:
  pid:   48213
  host:  deploy-runner-7
  user:  ci
  since: 2026-06-05 12:01:33

Release this lock? [y/N]
```

## Options

| Option | Description |
|---|---|
| `--yes` | Skip the confirmation prompt and release immediately. |
| `--json` | Emit `{ released, holder }` as JSON. |

Plus the [global flags](/guide/configuration#global-cli-flags).

::: warning Only when you're sure
Force-releasing a lock that another process still holds can let two runs proceed concurrently. Only
unlock when you've confirmed the holding process is actually dead.
:::

## Programmatic API

The same capability is available on `MigratorKit`:

```ts
const info = await migrator.lockInfo();   // → LockInfo | null
if (info) {
  await migrator.forceUnlock();
}
```
