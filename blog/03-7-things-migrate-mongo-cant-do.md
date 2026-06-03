# 7 Things migrate-mongo Can't Do (That Cost Me in Production)

I used `migrate-mongo` for years. It's a solid, simple tool. But every one of the gaps below cost me real time, real stress, or a real late-night incident at some point. This is the honest list.

For each one, I'll show what went wrong and what I do now instead. (The "instead" is `mongo-migrate-kit`, a tool I built after living through all of these. Fair warning.)

## 1. You can't roll back a single migration

This is the one that hurt the most.

I ran three migrations in one deploy. The third had a bug. I wanted to undo *just that one*. But `migrate-mongo down` only reverts the most recently applied migration, and there's no way to say "roll back this specific file."

So I either roll back all three (including two that were fine) or I do it by hand. I did it by hand. On production. It was not fun.

**What I do now:**

```bash
mmk down 20260101-the-broken-one.js
```

Roll back exactly one file. Or roll back a whole batch by number if you do want all three:

```bash
mmk down --batch 3
```

## 2. You can't preview a migration before it runs

`migrate-mongo` runs migrations the moment you tell it to. There's no "show me what you're about to do" mode.

In production, that's a leap of faith every single time. Which migrations are pending? What order will they run in? You find out by running them. People have been [asking for a dry run since 2019](https://github.com/seppevs/migrate-mongo/issues/43).

**What I do now** — every command has a dry run that touches nothing:

```bash
mmk dry-run up
mmk dry-run down
```

It prints the exact plan and writes nothing to the database. I run this before every production deploy now. It costs two seconds and has saved me more than once.

## 3. There's no lock, so two deploys can collide

Here's a fun one. Two CI jobs kicked off close together. Both ran migrations. Against the same database. At the same time.

You can imagine the mess. Half-applied state, a confused changelog, an afternoon of cleanup. `migrate-mongo` has no concurrency lock, so nothing stopped them.

**What I do now:** `mmk` takes an atomic lock in the database before running. If a second run starts while the first holds the lock, it stops and tells you who's holding it. Nothing to configure — it's on by default. (A stale lock past its TTL gets reclaimed automatically, and the lock is always released even if a migration throws.)

For local development where you don't care, you can skip it:

```bash
mmk up --no-lock
```

## 4. You can't tell if a migration file was edited after it ran

Someone edits an already-applied migration. Maybe to "fix" it. Maybe by accident in a merge. The file on disk no longer matches what actually ran against the database.

`migrate-mongo` has no idea. The changelog just says the filename ran. Whether the file still contains the same code? Not tracked. So your environments quietly drift apart and nobody knows until something breaks differently in staging and prod.

**What I do now:** `mmk` stores a SHA-256 checksum of every migration when it runs. On later runs it compares, and shows you drift right in the status table. You can make it strict so a mismatch stops everything:

```bash
mmk up --strict
```

And if you *meant* to change and re-run a file, you say so explicitly:

```bash
mmk up 20260101-add-index.js --force
```

## 5. There's no redo

When I'm writing a migration, my loop is: run it, check the result, it's wrong, undo it, fix the code, run it again. Over and over.

In `migrate-mongo` that's two commands every cycle, `down` then `up`, and you'd better hope `down` rolls back the right thing.

**What I do now:**

```bash
mmk redo
```

One command. Undo the last applied migration, run it again. Or redo a specific file:

```bash
mmk redo 20260101-add-index.js
```

Small thing. I use it constantly.

## 6. Rolling back deletes your history

When you roll back in `migrate-mongo`, the changelog entry is removed. The record that the migration ever ran is gone.

For an audit trail, that's the opposite of what you want. "Did this migration run last Tuesday and get rolled back, or did it never run?" You can't answer that if the evidence was deleted.

**What I do now:** `mmk` never deletes a record. A rollback *updates* the entry — it sets the status to `reverted` and stamps the time it happened. The history stays complete. Every record keeps its batch, status, applied time, reverted time, duration, checksum, environment, and who ran it. When something goes wrong months later, the full story is still there.

## 7. TypeScript is a setup chore

Plenty of teams write migrations in TypeScript. With `migrate-mongo` that means wiring up `ts-node` or a compile step yourself. It works, but it's plumbing you have to maintain, and it's one more thing that breaks.

**What I do now:** TypeScript is built in. So is plain JavaScript, in both ESM and CommonJS. A `.ts` migration just runs. The context is fully typed:

```ts
import type { MigrationContext } from 'mongo-migrate-kit';

export async function up({ db }: MigrationContext): Promise<void> {
  await db.collection('users').createIndex({ email: 1 }, { unique: true });
}

export async function down({ db }: MigrationContext): Promise<void> {
  await db.collection('users').dropIndex('email_1');
}
```

No `ts-node` config. No build step in the way. It just works.

## The honest bit

`migrate-mongo` isn't bad. For a small project that never grows complicated, it's genuinely fine, and I'm grateful for it — using it is what taught me what I actually needed.

But every gap above is something that bites *as a project gets bigger*. More migrations, more environments, more people deploying. That's exactly when you can least afford the manual cleanup.

If any of these felt familiar, the switch is easier than you'd think, because the tool I built to fix them can adopt your existing `migrate-mongo` history in one command:

```bash
npm install mongo-migrate-kit mongodb
mmk import --dry-run    # preview, writes nothing
mmk import              # adopt your history (your old changelog is never touched)
mmk up                  # carry on
```

It's on npm and GitHub as **mongo-migrate-kit**. If this list saved you from learning any of these the hard way, a star helps the next person find it too.
