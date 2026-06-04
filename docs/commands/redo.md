# mmk redo

Roll back then re-apply a migration in one step — the last applied, or a specific file.

```bash
mmk redo [file] [options]
```

## Usage

```bash
mmk redo            # down + up the most recently applied migration
mmk redo <file>     # down + up a specific migration
```

## How it works

`mmk redo` runs `down()` then `up()` for the target. It's the fast loop for iterating on a migration
during development:

```
↩ Reverted 20260605120000-add-users-index.js     [18ms]
✔ Applied  20260605120000-add-users-index.js     [40ms]
```

## Options

| Option | Description |
|---|---|
| `[file]` | Redo a specific migration file instead of the last applied one. |
| `--no-lock` | Skip the concurrency lock. **Dev only.** |
| `--json` | Emit the run results as a JSON array on stdout. |

Plus the [global flags](/guide/configuration#global-cli-flags).

## Notes

- `redo` inherits the [forward-only guard](/commands/down#forward-only-imported-migrations): an
  imported `migrate-mongo` record cannot be redone and is rejected up front.
- Because the `down` half reverts the record and the `up` half re-applies it, the audit trail keeps
  both events.

## Exit codes

| Code | Meaning |
|---|---|
| `0` | The migration was reverted and re-applied. |
| `1` | Either half threw, or the target isn't applied / is irreversible. |
