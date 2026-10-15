---
title: A normal day with mmk
description: The everyday workflow with mongo-migrate-kit, from writing and testing a MongoDB migration to code review, deploying, and rolling back a bad release.
---

# A normal day with mmk

<p class="page-meta">Step 2 of the learning path · about 8 minutes</p>

The other pages explain features one at a time. This one follows a migration from your laptop to
production, so you can see which command fits where.

## On your machine: write it and try it

Create the file, fill in `up` and `down`, run it. When you change your mind about the code, `mmk
redo` undoes it and runs it again in one go. Before you commit, run `mmk down` once to make sure the
rollback really works.

<Cast name="devloop" alt="Terminal: mmk create, mmk up, the file is edited, mmk redo reverts and re-applies it, then mmk down checks the rollback" />

That last step is the one people skip. A `down` that has never run is a `down` that probably doesn't
work, and you'll find out at the worst moment.

A few tips for this stage:

- **Use a local database with real-looking data.** A migration that's instant on 10 documents can
  take 20 minutes on 10 million. A copy of staging, or a seeded local database, catches that early.
- **`mmk redo` is safe to use on a file you're still editing.** It skips the [edited-file
  check](/guide/concepts#checksums) for the rollback half, because editing is the whole point here.
- **Only edit migrations that haven't left your machine.** Once a file has run on staging or
  production, it's history. Changes go in a new file.

## In code review: what to look at

Migrations deserve a closer look than most code, because they run once against real data and you
can't redeploy your way out of a bad one. When you review one, ask:

- Does `down` undo exactly what `up` did, and nothing else?
- If `up` dies halfway and runs again, does it do the right thing? (Filters like
  `{ field: { $exists: false } }` help.)
- How many documents does it touch? Over a few hundred thousand, it should work in batches.
- Does it import app models or helpers that might change later? Migrations should stand alone.
- Did anyone edit or rename a migration that already ran? (`git diff --stat migrations/` makes this
  easy to spot.)

You can also let CI check that every migration can go up and down. Against an empty test database:

```bash
npx mmk up                 # every migration applies from scratch
npx mmk down --steps 1     # the newest one rolls back
npx mmk up                 # and applies again
```

[Deploying and CI](/guide/ci-cd) has a full GitHub Actions example.

## On deploy day

The safe sequence is short:

```bash
npx mmk dry-run up     # what's going to run? (writes nothing)
npx mmk up             # run it
npx mmk status         # everything applied, checksums ok?
```

In a pipeline you'd usually run only `mmk up` as a step before the new app version starts, and stop
the deploy if it fails. If you start migrations from the app itself instead, see
[Running from your code](/guide/api).

## When a release goes wrong

First look, then act. Find out what's applied and in which batch:

```bash
npx mmk status
```

Then pick the smallest rollback that fixes the problem, and preview it:

```bash
npx mmk dry-run down                      # the whole last release
npx mmk dry-run down 20261014103000-add-orders-customer-index.js   # just one file
```

When the preview shows what you expect, run the same command without `dry-run`. The
[rollback picture](/guide/concepts#batches) shows what each form of `mmk down` undoes.

::: tip Roll back code and data in the right order
If the new app version depends on the migration (it reads a new field, say), roll the app back
first, then the migration. Otherwise the new code briefly runs against the old data. For changes
that have to work with both versions at once, see the
[expand and contract](/blog/mongodb-migration-best-practices#_9-change-the-schema-in-steps-the-running-code-can-live-with)
approach.
:::

## When a teammate's branch has migrations too

Two people each add a migration on separate branches, and both get merged. That's normal and fine.

`mmk up` runs every file that has no record, in name order. If your branch's file has an older
timestamp than one that already ran, it still runs on the next `mmk up`. You don't need to rename
anything.

The one thing to watch is when the two migrations touch the same data. Then the order matters, and
it's worth a quick chat before both are merged.

After you pull, `mmk status` shows what's new for your local database, and `mmk up` brings it up to
date.

## Next

That's the end of step 2. Step 3 starts with [Configuration](/guide/configuration): every setting,
environment variables, and what mmk tells you when a setting is wrong.
