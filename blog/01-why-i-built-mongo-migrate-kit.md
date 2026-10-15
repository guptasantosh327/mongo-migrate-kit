<!--
SEO target keyword: "migrate-mongo alternative" / "new mongodb migration tool"
Meta description: The story behind mongo-migrate-kit: one bad migration on a Friday, a tool that
could only undo the last one, and how I switched an existing project over in one command.
Published copy: docs/blog/why-i-built-mongo-migrate-kit.md (edit that one first, then run node scripts/blog-sync.mjs).
-->

# Why I built a new MongoDB migration tool

I didn't plan to write a migration tool. I planned to roll back one bad migration on a Friday
afternoon. I couldn't, so I spent two hours undoing it by hand instead.

## The Friday

We used migrate-mongo, and for a long time it was fine. You write an `up`, you write a `down`, you
run them in order. Then the project grew: more migrations, more environments, more people deploying.

That Friday I deployed three migrations together, and the third one was wrong. I wanted to undo only
that one. migrate-mongo's `down` undoes the last applied migration (or, with `--block`, the last
group). By then a colleague had deployed something else on top, so "the last one" wasn't mine any
more. There was also no way to see what a rollback would do before running it.

So I connected to production, reversed the changes by hand, and fixed the changelog entry. It
worked. It also felt like exactly the kind of manual surgery a migration tool is supposed to save
you from.

That evening I started a list of what I wished the tool could do.

## The list

After a week it looked like this:

- Run **one** migration file, not just "everything pending".
- Roll back **a specific file or an older batch**, not only the most recent.
- A **dry run** that shows the plan before anything happens.
- A **lock that's on by default**, so two deploys can't run migrations at once.
- **Checksums**, so I find out when someone edits a migration that already ran.
- A **`redo`** for the undo-and-run-again loop I did fifty times a day while writing migrations.
- A history that **keeps** rolled-back records, so "what ran, when, and who wrote it" always has an
  answer.

None of that is exotic. It's what you start wanting once a project is real. I waited for it to
appear, it didn't, so I built it. The package is `mongo-migrate-kit`, and the command is `mmk`.

Here's most of that list in thirty seconds of real output:

![Terminal: mmk dry-run up lists three pending migrations, mmk up applies them, mmk down rolls back one file by name, and mmk status shows the result](https://mongo-migrate-kit.vercel.app/gifs/hero.gif)

## The part I was dreading: switching

The hard part of changing migration tools isn't writing new migrations. It's moving a project that
already has fifty of them applied in staging and production.

"Just run everything again with the new tool" is a scary sentence when those migrations ran months
ago. You don't want to rebuild indexes that exist, insert seed data twice, or touch production data
that's already right.

So I made the switch one boring, read-only-first command:

```bash
npx mmk import --dry-run   # show what would be copied
npx mmk import             # copy it
npx mmk up                 # runs only what's new
```

`mmk import` reads migrate-mongo's `changelog` collection and writes the same history into mmk's own
collection. It never writes to the old one, so if you change your mind, you delete one collection
and you're back where you started. After the import, `mmk up` knows what already ran and only runs
the new files.

![Terminal: mmk import --dry-run previews three migrate-mongo records, mmk import copies them, and mmk up applies only the one new migration](https://mongo-migrate-kit.vercel.app/gifs/import.gif)

I built the `--dry-run` first, honestly, because I didn't trust my own tool until I could see the
plan.

## One honest catch

Imported migrations are forward-only. mmk won't roll them back.

migrate-mongo calls your functions as `up(db, client)`. mmk calls them as `up({ db, client })`. If
mmk ran an old file's `down` with the wrong arguments, it might do something odd to your data, and I
didn't want to guess. So it refuses, before touching anything. New migrations roll back normally,
and if you need an old one to be reversible, you add the braces to that one file.

## Was it worth it?

For me, yes. I use it every day, and I haven't had another Friday like that one. I dry-run every
production deploy. When one migration goes wrong I roll back that one. The lock has stopped two CI
jobs from racing more than once. And the history is complete, because nothing is ever deleted from
it.

If you're on migrate-mongo and some of that list sounded familiar, try the import on a copy of your
database:

```bash
npm install mongo-migrate-kit mongodb
npx mmk import --dry-run
```

The [docs](https://mongo-migrate-kit.vercel.app/guide/) start with a five-minute quick start. If it saves you a Friday, a star on
[GitHub](https://github.com/guptasantosh327/mongo-migrate-kit) helps other people find it.

---

### Related reading

- [How to roll back a single MongoDB migration](./05-rollback-specific-mongodb-migration.md), the problem
  that started all this.
- [Switching from migrate-mongo, step by step](./02-switching-from-migrate-mongo-guide.md).
