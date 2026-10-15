---
title: "How to roll back a single MongoDB migration"
description: "Most MongoDB migration tools only undo the last migration. Here's how to roll back one specific migration, one old batch, or the last few, and how to preview it first."
date: 2026-07-01
author: Santosh Gupta
---

# How to roll back a single MongoDB migration

If you searched for this, I can guess your afternoon. You ran a few migrations, one of them was
wrong, and now you want to undo that one. Not all of them, just the bad one. And your migration tool
isn't making it easy.

I've been there. This post covers why it's awkward with most tools, and how I do it now.

## Why "undo the last one" isn't enough

Most MongoDB migration tools treat rollback like a stack. `down` undoes the most recently applied
migration. Run it again and it undoes the one before.

That's tidy in theory and awkward in real projects:

- You shipped **three** migrations in one release and only the third is broken. If anything ran
  after it, you have to peel good migrations off to reach the bad one.
- Several people deploy to several environments. "The last applied migration" is different on
  staging, on production and on your laptop.
- The broken migration isn't the most recent one at all.

Each time, you end up choosing between rolling back more than you wanted, or fixing it by hand in
the database. I did the by-hand version once, on production, and that's the reason I
[built a different tool](./why-i-built-mongo-migrate-kit).

## Roll back by name

What you actually want is "undo this file". With mongo-migrate-kit (the command is `mmk`), you pass
the file name:

```bash
npx mmk down 20261014103000-add-orders-customer-index.js
```

That runs that file's `down()` and nothing else. The other migrations from the same release stay as
they are.

If the whole release was bad, undo it as a unit. Each `mmk up` run gets a batch number, so:

```bash
npx mmk down             # the last batch
npx mmk down --batch 3   # an older batch, by number
```

And if you think in terms of "the last few changes, whatever release they came from":

```bash
npx mmk down --steps 2   # the last two migrations, newest first
```

Here's what each of those undoes, side by side:

<Diagram name="batches" />

And a real session, undoing a batch and then one more file:

<Cast name="rollback" alt="Terminal: mmk status shows four migrations in two batches; mmk down reverts batch 2; mmk down --steps 1 reverts one more; mmk status shows the result" />

## Preview it first

The scary part of any rollback is not knowing what it'll do until it's done. So ask first. This
writes nothing:

```bash
npx mmk dry-run down 20261014103000-add-orders-customer-index.js
```

It lists exactly which migrations would be rolled back, in order. I do this before every production
rollback. It takes two seconds.

## A safety check you might not think of

Here's a failure that's easy to miss. Someone edits a migration after it ran. Later you try to roll
it back. Now the `down()` you're about to run was written for different code than the `up()` that
actually changed your data.

mmk saves a checksum of each file when it runs, and checks it again before a rollback. If the file
changed, it refuses:

```text
✖ CHECKSUM_MISMATCH: Refusing to roll back a file that changed since being applied: 20261012091500-backfill-order-status.js
  Rolling back would run the CURRENT down(), which may not undo what the applied up() did
  Restore the file to the version that was applied, then roll back
  Or roll back with the current code anyway: mmk down 20261012091500-backfill-order-status.js --force
```

If you've checked and really mean it, `--force` gets you past it. But you have to ask.

## The history stays

Rolling back doesn't erase the record of the migration. It's marked `reverted` with the time it
happened. When something breaks at 2am, "what actually happened to this database?" is a question you
can answer instead of guess.

## Summary

```bash
npx mmk down <file>           # one migration
npx mmk down --batch <n>      # one release
npx mmk down --steps <n>      # the last N, ignoring releases
npx mmk dry-run down <file>   # preview any of the above
```

That's what I wished I'd had on the Friday this all started.

## Try it

```bash
npm install mongo-migrate-kit mongodb
```

The [quick start](/guide/getting-started) takes about five minutes. The package is on
[npm](https://www.npmjs.com/package/mongo-migrate-kit) and
[GitHub](https://github.com/guptasantosh327/mongo-migrate-kit).

---

### Related reading

- [Why I built a new MongoDB migration tool](./why-i-built-mongo-migrate-kit), the Friday that
  started this.
- [7 things I kept missing in migrate-mongo](./7-things-migrate-mongo-cant-do). Single-file
  rollback is the first one.
