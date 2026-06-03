# Why I Built a New MongoDB Migration Tool — and Migrated Off migrate-mongo in One Command

I didn't set out to build a migration tool. I set out to roll back one bad migration on a Friday afternoon, couldn't, and spent the next two hours writing a manual script while my coffee went cold.

That was the moment.

## The Friday that started it

We were using `migrate-mongo`. It's a fine tool. It does the basics well — you write an `up`, you write a `down`, you run them in order. For a long time that was enough.

Then our project grew. More migrations, more environments, more people deploying. And the small gaps started to hurt.

That Friday, I had run a batch of three migrations. The third one was wrong. I wanted to undo just that one. But `migrate-mongo` only rolls back the *last applied* migration, and the "last" wasn't always what I expected once a few people had deployed. There was no way to say "roll back this specific file." There was no way to preview what a rollback would even do before running it.

So I did it by hand. Connected to the database, undid the changes manually, fixed the changelog entry. It worked. But it felt wrong. A migration tool is supposed to *prevent* this kind of manual surgery, not cause it.

I started writing down everything I wished the tool could do.

## The list kept growing

Here's what was on it after a week:

- Run **one** migration file, not just "all pending."
- Roll back **a specific file or a specific batch**, not just the last one.
- A **dry run** — show me what would happen before it happens. (People have been asking `migrate-mongo` for this [since 2019](https://github.com/seppevs/migrate-mongo/issues/43).)
- A **lock**, so two deploys can't run migrations at the same time and trample each other.
- **Checksums**, so if someone edits a migration that already ran, I find out.
- A `redo` command for the "undo it and run it again" loop I did fifty times a day in development.
- **First-class TypeScript**, without the `ts-node` plumbing dance.
- An audit trail that **never deletes history** — because "what ran, when, and by whom" matters when something breaks at 2am.

None of these are exotic. They're the things you reach for the moment a project gets real. I kept waiting for them to show up. They didn't. So I built them.

The result is `mongo-migrate-kit`. The CLI is called `mmk`.

## How it compares

I'll let the table do the talking. This is `migrate-mongo` versus `mongo-migrate-kit`:

| Capability | `migrate-mongo` | `mongo-migrate-kit` |
|---|:---:|:---:|
| `up` / `down` / `create` / `status` | ✅ | ✅ |
| Dry-run preview | ❌ | ✅ |
| Run a single migration file | ❌ | ✅ |
| Roll back a specific batch or file | ❌ *(last only)* | ✅ |
| `redo` (down + up) | ❌ | ✅ |
| SHA-256 checksum / tamper detection | ❌ | ✅ |
| Lifecycle hooks | ❌ | ✅ |
| First-class TypeScript | community setup | ✅ built-in |
| History preserved on rollback | ❌ *(entry removed)* | ✅ *(never deleted)* |
| Adopt an existing `migrate-mongo` changelog | — | ✅ `mmk import` |

That last row is the one I care about most. Because a better tool is useless if switching to it is painful.

## The part I was dreading: switching

Here's the thing nobody tells you about migration tools. The hardest part isn't writing migrations. It's *moving* once you've already got fifty of them applied across staging and production.

I'd been burned by this before. "Just re-run everything against the new tool" is terrifying when those migrations already ran months ago. You don't want to re-create an index that exists. You don't want to re-insert seed data. You absolutely do not want to touch production data that's already correct.

So I made the switch a single, boring, safe command:

```bash
mmk import
```

That's it. It reads your existing `migrate-mongo` changelog and records that history in `mmk`, so `mmk` knows exactly what's already been applied. Then:

```bash
mmk up
```

runs only the migrations you've added since. Your old ones are recognized as already done.

Here's what `mmk import` actually does, because I know you're suspicious (good):

- It **reads** your `migrate-mongo` changelog. It never writes to it. Your old tool's data is left completely alone.
- It maps each entry over: the filename, when it was applied, and the checksum (it reuses `migrate-mongo`'s stored hash if it still matches the file on disk, otherwise recomputes it).
- Files that are on disk but not yet in the changelog stay **pending** — they run on your next `mmk up`, exactly like you'd want.

And if you want to see it before you trust it:

```bash
mmk import --dry-run
```

This previews the whole mapping and writes nothing. I built this first, honestly, because I didn't trust *my own tool* until I could see the plan.

## One honest caveat

Imported migrations are forward-only. You can't roll them back with `mmk`.

There's a real reason. `migrate-mongo` files use a positional `up(db, client)` signature. `mmk` passes a single context object instead. Running an old file's `down` under the new runner could behave in ways I can't guarantee are safe, so I'd rather refuse it loudly than corrupt your data quietly:

```text
✖ Cannot roll back 1 migrate-mongo-imported migration(s): 20260101-add-index.js
```

If you need an old migration to be reversible under `mmk`, you re-write that one file in the native format. New migrations you write going forward are fully reversible. I'd rather be upfront about this than pretend the seam doesn't exist.

## Was it worth building?

For me, yes — because I use it every day and I never did the Friday manual-surgery thing again.

A dry run before every production migration. Single-file rollbacks when one thing goes wrong instead of nuking the whole batch. A lock that's saved me from two CI jobs racing. And a full history I can actually trust, because nothing ever gets deleted from it.

If you're on `migrate-mongo` and you've felt any of the gaps in that table, give it ten minutes:

```bash
npm install mongo-migrate-kit mongodb
mmk import --dry-run    # look before you leap
mmk import              # adopt your history
mmk up                  # carry on as normal
```

It won't touch your old changelog. Worst case, you delete one collection and you're back where you started.

GitHub and npm: **mongo-migrate-kit**. If it saves you a Friday, a star helps other people find it.
