# Distribution kit: mongo-migrate-kit

Ready-to-paste versions of the first three posts for each platform. Each platform has its own
habits, so these aren't copies of each other. They're written the way people actually post there.

**Ground rules**

- Replace `LINK` with the real URL once a post is live.
- Don't post the same thing everywhere on the same day. Space it out.
- On Reddit and the MongoDB forum, be a person sharing something you made, not a brand. Reply to
  comments. That's where the reach comes from.
- **Images:** Medium, Dev.to, Hashnode and LinkedIn don't show SVG. Use the GIFs and PNGs instead:
  - Terminal recordings: `https://mongo-migrate-kit.vercel.app/gifs/<name>.gif`
    (`hero`, `quickstart`, `tutorial`, `rollback`, `lock`, `checksum`, `failure`, `import`,
    `devloop`, `ci-check`, `namespaces`, `config-error`)
  - Diagrams: `https://mongo-migrate-kit.vercel.app/diagrams/png/<name>.png`
    (`batches`, `how-up-works`, `transaction`, `shared-database`, `expand-contract`)
  - The draft posts in this folder already use these URLs. Regenerate them with
    `node scripts/casts/gif.mjs` after re-recording the casts.

---

## 1. Dev.to (full cross-post)

Dev.to takes the whole article. Put this front matter at the top, then paste the post body under
it. `canonical_url` tells Google which copy is the original, so the two don't compete.

### Post 1: the story

```markdown
---
title: "Why I built a new MongoDB migration tool"
published: true
description: "One bad migration on a Friday, a tool that could only undo the last one, and switching an existing project over in one command."
tags: mongodb, node, typescript, opensource
canonical_url: LINK
cover_image: https://mongo-migrate-kit.vercel.app/gifs/hero.gif
---

(paste the body of 01-why-i-built-mongo-migrate-kit.md here)
```

### Post 2: the switching guide

```markdown
---
title: "Switching from migrate-mongo to mongo-migrate-kit, step by step"
published: true
description: "Move an existing project off migrate-mongo without re-running old migrations, losing history, or touching the old changelog."
tags: mongodb, node, database, tutorial
canonical_url: LINK
---

(paste the body of 02-switching-from-migrate-mongo-guide.md here)
```

### Post 3: the list

```markdown
---
title: "7 things I kept missing in migrate-mongo"
published: true
description: "Seven gaps in migrate-mongo that cost me time in production, and what I do now."
tags: mongodb, node, webdev, opensource
canonical_url: LINK
---

(paste the body of 03-7-things-migrate-mongo-cant-do.md here)
```

> Dev.to allows four tags. Broad ones (`mongodb`, `node`, `typescript`, `webdev`) get the most
> traffic.

---

## 2. Hashnode (full cross-post)

Same idea as Dev.to. In the Hashnode editor, open **Article Settings → SEO → Canonical URL**, paste
the original link, then paste the body.

Tags (Hashnode allows more than Dev.to):
- Post 1: `MongoDB`, `Node.js`, `TypeScript`, `Open Source`, `Databases`
- Post 2: `MongoDB`, `Node.js`, `Databases`, `Tutorial`, `Backend`
- Post 3: `MongoDB`, `Node.js`, `Web Development`, `DevOps`, `Open Source`

Subtitles:
- Post 1: "One bad Friday, and the one command that made switching easy."
- Post 2: "Move off migrate-mongo without running a single old migration again."
- Post 3: "The gaps that bit me in production, and what I use now."

---

## 3. LinkedIn

LinkedIn does best with a personal story in short lines. Put the link in the **first comment**, not
the post (LinkedIn shows posts with links to fewer people). Attach `hero.gif` to the post itself:
a moving terminal stops people scrolling better than any sentence.

### Version A: the story

```
I started writing a migration tool because of one bad Friday.

I'd shipped three database migrations together. The third one was wrong.
I wanted to undo just that one.

Our tool could only undo "the last one", and by then
someone else had deployed on top. There was no way to
point at a single file, and no way to see what a rollback
would do before running it.

So I fixed it by hand. On production.

That evening I started a list of what I wanted instead:
- undo one specific migration, not just the last one
- see the plan before anything touches the database
- a lock, on by default, so two deploys can't collide
- notice when someone edits a migration that already ran
- keep the history when something is rolled back

That list became mongo-migrate-kit. The GIF is a real session:
preview, run, undo one file, check the status.

If you're on migrate-mongo, switching is one command.
It copies your history and never touches the old collection.

Link in the first comment.

What's the worst migration you've had to undo by hand?

#MongoDB #NodeJS #OpenSource
```

First comment:

```
The write-up and the repo: LINK
If you try it, I'd really like to hear what's confusing.
```

### Version B: short

```
I open-sourced a MongoDB migration tool for Node.js.

If you've used migrate-mongo and wished you could:
- roll back one specific migration
- dry-run before touching production
- have a lock that's on by default

this does that. Switching is one command: it copies your
existing migrate-mongo history and doesn't re-run anything.

Link in the comments.

#MongoDB #NodeJS #OpenSource
```

---

## 4. Reddit

Reddit pays off the most and forgives the least.

- No marketing voice. Write like you're telling a colleague.
- Story in the post body. Link at the end, low-key.
- Read each subreddit's self-promotion rules first. Most allow "I built this" if you stick around
  in the comments.
- Reply to every comment for the first few hours.

### r/node

Title:

`I kept running into the same migrate-mongo gaps, so I built a MongoDB migration tool`

Body:

```
I've used migrate-mongo on Node projects for years. It's good, but a few
things kept costing me time as projects grew:

- down only undoes the last migration (or the last block), never a specific file
- no dry run, so you find out what will run by running it
- the lock is off unless you configure it, and we hadn't
- edits to applied migrations go unnoticed
- rolling back deletes the changelog entry, which hurts when you're
  trying to work out what happened

So I built mongo-migrate-kit. You can run or roll back a single file, roll
back an older batch, dry-run anything, and there's a lock in MongoDB that's
on by default. It keeps a checksum of each file and refuses to roll back
edited code unless you force it. Rollbacks mark records as reverted
instead of deleting them.

The part I spent the most time on is switching: `mmk import` copies an
existing migrate-mongo history without touching the old collection, so
nothing runs twice.

It's on npm and GitHub as mongo-migrate-kit, with docs here: LINK

Happy to hear "this already exists" or "you got X wrong". That's why
I'm posting.
```

### r/mongodb

Title:

`Built a Node migration tool: lock document, checksums, single-file rollbacks`

Body: the same story, but open with the MongoDB details this crowd cares about: the lock is one
document taken with an atomic `findOneAndUpdate` upsert, with an expiry on the server clock and a
heartbeat for long migrations; transactions write the history record in the same session; the
history and lock are written with `w: 'majority'`.

### r/typescript

Title:

`A MongoDB migration tool with a typed migration context and typed error codes`

Body: lead with the types (`MigrationContext`, every error has a `code`, `--json` output for
scripts), mention that `.ts` migrations run directly on Node 22.18+, then the feature list.

> Don't post to all three on the same day. Space them a few days apart. The same post in three
> places on one day looks like spam and gets removed.

---

## 5. MongoDB Community Forums

The forum (community.mongodb.com) is for useful, technical posts. Use the "Developer Tools" category
or whichever fits. Lead with the problem and the design, not the pitch.

Title:

`Open-sourced a MongoDB migration tool for Node.js, feedback welcome`

Body:

```
Hi all,

I've released an open-source migration tool for Node.js called
mongo-migrate-kit, and I'd like feedback from people who know MongoDB
better than I do.

A few design choices I'd love thoughts on:

- Lock: one document in a dedicated collection, taken with an atomic
  findOneAndUpdate upsert. Each holder writes an expiry based on the
  server's clock, and renews it while a migration runs, so a crashed
  process can't block everyone forever and a long migration doesn't
  lose its lock.
- Transactions: opt-in per migration. The runner starts a session,
  passes it to the migration, and writes the history record in the
  same transaction before committing, so the change and its record
  commit together.
- Edited files: it stores a SHA-256 of each migration file. Rolling
  back a file that changed since it ran is refused unless forced.
- History: a rollback marks the record "reverted" instead of
  deleting it.
- Switching: it can read an existing migrate-mongo changelog (read-only)
  and copy that history, so applied migrations don't run again.

Docs and repo: LINK

I'd especially appreciate a hard look at the lock and the transaction
handling. If there's an edge case I've missed, I want to know.

Thanks!
```

> This crowd responds to "tell me what I got wrong". That framing gets real engineering replies.

---

## 6. Discord (MongoDB, Node.js and similar servers)

Casual and quick. One or two lines in the right channel (`#showcase`, `#i-made-this`,
`#show-and-tell`). No walls of text, no @everyone.

### Short

```
I made a MongoDB migration tool for Node: mongo-migrate-kit.
Roll back one specific migration, dry-run before you touch prod, a lock
that's on by default, and history that's kept when you roll back.
If you're on migrate-mongo, it imports your existing history in one command.
LINK (feedback very welcome)
```

### Shorter (for busy channels)

```
Open-source MongoDB migration tool for Node: single-file rollbacks, dry runs,
locking, checksums, one-command switch from migrate-mongo. LINK
```

> After posting, stay around and answer questions. A couple of good replies do more than the post.

---

## Suggested schedule

Don't post everything at once. Spreading it over about two weeks keeps each post fresh:

| Day | What |
| --- | --- |
| 1 | Publish post 1 (the story). LinkedIn version A with `hero.gif`. |
| 2 | Cross-post post 1 to Dev.to and Hashnode (canonical pointing to the original). |
| 4 | r/node. Spend the day replying. |
| 6 | Publish post 3 (the list) and cross-post. |
| 7 | r/mongodb, leading with the database details. |
| 9 | MongoDB Community Forums. |
| 10 | Discord one-liner in one or two showcase channels. |
| 12 | Publish post 2 (the switching guide) and cross-post. |
| 14 | LinkedIn version B, linking the switching guide. |

The switching guide goes last on purpose. It's the one that keeps bringing in search traffic for
months, so it doesn't need the launch-day burst.
