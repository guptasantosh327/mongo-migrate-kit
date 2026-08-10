<!--
SEO target keyword: "how to rollback a single mongodb migration" / "rollback specific mongodb migration"
Meta description: migrate-mongo only rolls back the last migration. Here's how to roll back one
specific MongoDB migration safely — by file, by batch, or the last N — without nuking the rest.
-->

# How to Roll Back a Single MongoDB Migration (Without Nuking the Rest)

If you've searched for this, I can probably guess your afternoon: you ran a few migrations, one of
them was wrong, and now you want to undo *that one*. Not all of them. Just the bad one.

And you've discovered that your migration tool doesn't really want to let you.

I've been exactly there. This post is the straight answer to "how do I roll back a single MongoDB
migration," why the usual tools make it hard, and how I do it now.

## Why "just roll back the last one" isn't enough

Most MongoDB migration tools — `migrate-mongo` being the common one — model rollback as a stack:
`down` reverts the **most recently applied** migration. Run it again, it reverts the next one up.

That's clean in theory. It breaks down the moment your project is real:

- You deployed **three** migrations in one release and only the third is broken. Rolling back "the
  last one" is fine *if* you catch it immediately — but if anything else applied after it, you're
  now peeling back good migrations to reach the bad one.
- You have **multiple environments and teammates** deploying. "The last applied migration" on
  staging isn't the same as on production, and neither matches your local. "Last" stops being
  obvious.
- You want to undo a migration that **isn't** the most recent one at all.

In every one of these cases the stack model forces a choice: roll back *more than you wanted*, or
go into the database and fix it **by hand**. I did the by-hand thing once, on production, and that
incident is the reason I [built a different tool](./01-why-i-built-mongo-migrate-kit.md).

## The fix: roll back by name

The capability you actually want is "roll back this specific file." With **mongo-migrate-kit** (the
CLI is `mmk`), that's the default:

```bash
mmk down 20260101120000-the-broken-one.js
```

That reverts exactly that migration — it runs *its* `down()` function and nothing else. The two
good migrations from the same release stay applied. No stack-peeling, no manual surgery.

If you *do* want to undo the whole release, you can — by batch number:

```bash
mmk down --batch 3
```

A "batch" is everything that ran together in one `mmk up`. So `--batch 3` cleanly reverts that one
deploy as a unit. This is the right tool when the whole release was bad, not just one file.

And if you think in terms of "undo the last N things, whatever batch they were in":

```bash
mmk down --steps 2     # revert the last 2 applied migrations, newest first
```

Three different questions — "this file," "this release," "the last N" — three precise answers.
That's the whole point.

## Look before you leap

The genuinely scary part of any rollback is not knowing what it'll do until it's done. So preview
it first — this touches nothing in the database:

```bash
mmk dry-run down 20260101120000-the-broken-one.js
```

It prints exactly which migration(s) would be reverted and in what order, and writes nothing. I run
this before every production rollback now. It costs two seconds.

## The safety net you didn't know you needed

Here's a failure mode that's easy to miss: someone **edits** a migration file after it was applied,
then later you try to roll it back. Now the `down()` you're about to run doesn't match the `up()`
that actually ran. You'd be reverting code that never executed against this database.

`mmk` guards against this. Before a rollback it compares each file's current SHA-256 checksum
against the checksum recorded when it was applied. If they don't match, it **aborts the whole
rollback** rather than running a `down()` that doesn't correspond to reality:

```text
✖ Checksum mismatch: 20260101120000-the-broken-one.js was edited after it was applied
```

It's deliberately stricter on `down` than on `up`, because reverting edited code is the riskier
case. If you genuinely mean it, `--force` overrides — but you have to ask for it on purpose. (More
on tamper detection in the [checksum deep-dive](./09-mongodb-migration-best-practices.md).)

## And it never deletes your history

When you roll a migration back, the record isn't erased. It's marked `reverted` with a
`revertedAt` timestamp. The full audit trail — what ran, when, by whom, how long it took — stays
intact. When something breaks at 2am, "what actually happened to this database" is a question you
can answer, not guess.

## The one-line version

```bash
mmk down <file>          # roll back exactly one migration
mmk down --batch <n>     # roll back one whole release
mmk down --steps <n>     # roll back the last N, ignoring batches
mmk dry-run down <file>  # preview any of the above, change nothing
```

That's the thing I wished I'd had on the Friday this all started.

## Try it

If "I just want to undo *this one* migration" is a sentence you've said out loud:

```bash
npm install mongo-migrate-kit mongodb
mmk dry-run down <file>   # preview
mmk down <file>           # roll back exactly one
```

Docs and recipes: **https://mongo-migrate-kit.vercel.app** · on npm and GitHub as
**mongo-migrate-kit**. If it saves you a manual-rollback afternoon, a star helps the next person
find it.

---

### Related reading

- [Why I Built a New MongoDB Migration Tool](./01-why-i-built-mongo-migrate-kit.md) — the Friday
  that started all of this.
- [7 Things migrate-mongo Can't Do](./03-7-things-migrate-mongo-cant-do.md) — single-file rollback
  is #1, but it's not the only gap.
