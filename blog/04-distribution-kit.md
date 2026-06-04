# Distribution Kit — mongo-migrate-kit

Platform-native versions of the three blog posts. Each platform has its own etiquette, so these
aren't copy-paste clones — they're written the way people actually post on each one.

**Golden rules:**
- Replace `LINK` with the real Medium (or Dev.to) URL once published.
- Don't post the same thing everywhere on the same day. Space it out.
- On Reddit and the MongoDB forum, **be a person sharing something, not a brand advertising.** Reply to
  comments. That's where the real reach comes from.

---

## 1. Dev.to (full cross-post)

Dev.to lets you paste the whole article. Put this frontmatter at the very top, then paste the post body
below it. The `canonical_url` tells Google "Medium is the original," so you don't compete with yourself.

### Post 1 — Origin story
```markdown
---
title: "Why I Built a New MongoDB Migration Tool — and Migrated Off migrate-mongo in One Command"
published: true
description: "migrate-mongo couldn't roll back a single migration. So I built a tool that can — and made switching a one-command, non-destructive step."
tags: mongodb, node, typescript, opensource
canonical_url: LINK
---

(paste the full body of 01-why-i-built-mongo-migrate-kit.md here)
```

### Post 2 — Switch guide
```markdown
---
title: "Switching from migrate-mongo to mongo-migrate-kit: A Zero-Downtime, Non-Destructive Guide"
published: true
description: "A step-by-step guide to moving an existing project off migrate-mongo without re-running old migrations or losing history."
tags: mongodb, node, database, tutorial
canonical_url: LINK
---

(paste the full body of 02-switching-from-migrate-mongo-guide.md here)
```

### Post 3 — Listicle
```markdown
---
title: "7 Things migrate-mongo Can't Do (That Cost Me in Production)"
published: true
description: "Seven real gaps in migrate-mongo that bit me in production — and what I do instead now."
tags: mongodb, node, webdev, opensource
canonical_url: LINK
---

(paste the full body of 03-7-things-migrate-mongo-cant-do.md here)
```

> Dev.to allows a max of 4 tags. Keep them broad — `mongodb`, `node`, `typescript`, `webdev` get the
> most traffic.

---

## 2. Hashnode (full cross-post)

Same idea as Dev.to. In the Hashnode editor, open **Article Settings → SEO → Canonical URL** and paste
your Medium link there. Then paste the article body.

Suggested tags (Hashnode lets you add more than Dev.to):
- Post 1: `MongoDB`, `Node.js`, `TypeScript`, `Open Source`, `Databases`
- Post 2: `MongoDB`, `Node.js`, `Databases`, `Tutorial`, `Backend`
- Post 3: `MongoDB`, `Node.js`, `Web Development`, `DevOps`, `Open Source`

Suggested subtitles (Hashnode shows a subtitle field):
- Post 1: "The story behind mongo-migrate-kit — and the one command that makes switching painless."
- Post 2: "Move off migrate-mongo without re-running a single old migration."
- Post 3: "The gaps that bit me in production, and what I reach for now."

---

## 3. LinkedIn

LinkedIn rewards a personal story with short lines and white space. No big paragraphs. Put the link in
the **first comment**, not the post body (LinkedIn throttles posts with outbound links). End with a
soft question to invite comments — that's what feeds the algorithm.

### Version A — the story (best performer)
```
A bad migration on a Friday afternoon is how this started.

I'd run three database migrations. The third was wrong.
I wanted to undo just that one.

My tool could only undo "the last one."
No way to target a single file. No way to preview a rollback.

So I did it by hand. On production. Coffee went cold.

That afternoon I started a list of everything a MongoDB
migration tool should do but didn't:

→ roll back a single file, not just the last one
→ preview a run before it touches the database
→ a lock so two deploys can't collide
→ checksums to catch edited migrations
→ never delete history on rollback

I built it. It's called mongo-migrate-kit.

The part I'm proudest of: if you're already on migrate-mongo,
you switch in one command. It reads your existing history,
never touches your old data, and runs only what's new.

Link in the comments. 👇

What's the worst migration story you've lived through?

#MongoDB #NodeJS #TypeScript #OpenSource #BackendDevelopment
```
First comment:
```
Here's the write-up (and the repo): LINK
Would genuinely love feedback if you give it a try.
```

### Version B — short and direct
```
I open-sourced a MongoDB migration toolkit for Node.js.

If you've used migrate-mongo and wished you could:
• roll back a single migration (not just the last one)
• dry-run before touching production
• stop two deploys racing each other

...this does all of that.

And switching is one command — it adopts your existing
migrate-mongo history without re-running anything.

TypeScript and JavaScript both work out of the box.

Link in the comments.

#MongoDB #NodeJS #OpenSource #Database
```

---

## 4. Reddit

Reddit is the highest-reward and least-forgiving. Rules:
- **No marketing voice.** Write like you're telling a colleague.
- Put context/story in the **post body**, put the link in a **comment** or at the end, low-key.
- Read each subreddit's self-promo rules first. Most allow "I built this" if you engage in the comments.
- Reply to every comment for the first few hours.

### r/node — title
`I kept hitting the same migrate-mongo limitations, so I built a MongoDB migration tool that fixes them`
Body:
```
I've used migrate-mongo for years on Node projects. It's solid, but a few
gaps kept biting me as projects grew:

- can't roll back a single migration, only the last one
- no dry-run before it touches the DB
- no lock, so two CI deploys could race
- no checksum, so an edited migration silently drifts
- rolling back deletes the changelog entry (bad for audits)

So I built mongo-migrate-kit. Single-file up/down, dry-runs, a MongoDB-native
lock, SHA-256 checksums, redo, and an append-only history that never gets deleted.
TS and JS both work with no ts-node setup.

The thing I worked hardest on is switching: `mmk import` adopts your existing
migrate-mongo changelog in one command without touching your old data, so
it knows what's already applied and only runs what's new.

Repo + npm: mongo-migrate-kit. Happy to answer anything, and genuinely open
to "this already exists" or "you got X wrong" — that's why I'm posting.
```

### r/mongodb — title
`Built a migration tool with a native lock, checksums, and single-file rollbacks`
Body: same as above, but open with the MongoDB-specific bits (lock document in a collection, transactions
via session, checksum tamper detection) since that crowd cares about the DB internals more than the CLI.

### r/typescript — title
`A TypeScript-first MongoDB migration toolkit (no ts-node setup, fully typed context)`
Body: lead with the TypeScript angle — strict types, typed `MigrationContext`, typed errors with codes,
`.ts`/ESM/CJS all first-class — then mention the feature list.

> Tip: don't post to all three on the same day. Space them several days apart. Cross-posting the exact
> same thing the same day looks like spam and gets removed.

---

## 5. MongoDB Community Forums

The forum (community.mongodb.com) is for genuinely helpful, technical posts. Pick the **"Developer Tools"**
or relevant category. Lead with the problem and the design, not the pitch.

Title:
`Open-sourced a MongoDB migration toolkit for Node.js — feedback welcome`
Body:
```
Hi all,

I've released an open-source MongoDB migration toolkit for Node.js called
mongo-migrate-kit, and I'd value feedback from this community.

A few design choices I made specifically around MongoDB that I'd love thoughts on:

- Concurrency lock: an atomic lock document (findOneAndUpdate with upsert) in a
  dedicated collection, with a TTL so a crashed process doesn't leave it stuck.
  Goal is to stop two deploys migrating the same database at once.
- Transactions: opt-in per migration via a flag; the runner opens a session,
  passes it through, commits on success, aborts on error. (Requires a replica
  set / sharded cluster, per MongoDB's own rules.)
- Tamper detection: stores a SHA-256 of each migration file and compares on later
  runs to catch files edited after they were applied.
- Append-only audit trail: a rollback updates the record's status to "reverted"
  rather than deleting it, so the full history is preserved for compliance.
- Adoption path: it can read an existing migrate-mongo changelog (read-only,
  never modified) and adopt that history so you don't re-run applied migrations.

It supports TypeScript and JavaScript (ESM + CJS). Peer-deps on the native driver,
optional Mongoose.

Repo: <link>

I'd especially appreciate scrutiny on the lock approach and the transaction
handling — if there's an edge case I've missed, I want to hear it.

Thanks!
```

> The forum crowd respects "tell me what I got wrong." That framing gets real engineering replies
> instead of crickets.

---

## 6. Discord (MongoDB Discord, Node.js Discord, etc.)

Discord is casual and fast. One or two lines, drop it in the right channel (usually `#showcase`,
`#i-made-this`, or `#show-and-tell`). Don't paste a wall of text. Don't @everyone.

### Short version
```
Made a MongoDB migration toolkit for Node — mongo-migrate-kit 🚀
Single-file rollbacks, dry-runs, a native lock, checksums, and an audit trail
that never deletes history. TS + JS both work out of the box.

If you're on migrate-mongo, it adopts your existing changelog in one command.
Repo: LINK — feedback very welcome 🙏
```

### Even shorter (for fast-moving channels)
```
Built an open-source MongoDB migration tool for Node: single-file rollbacks,
dry-runs, locking, checksums. Switches from migrate-mongo in one command. LINK
```

> After posting, hang around and answer questions. On Discord, a couple of good replies do more than
> the post itself.

---

## Posting schedule (suggested)

Don't fire everything at once. A calm rollout over ~2 weeks looks organic and keeps each post fresh:

| Day | Action |
|---|---|
| 1 | Publish Post 1 (story) on Medium. Share on LinkedIn (Version A). |
| 2 | Cross-post Post 1 to Dev.to + Hashnode (canonical → Medium). |
| 4 | Post to r/node. Spend the day replying to comments. |
| 6 | Publish Post 3 (listicle) on Medium + Dev.to. |
| 7 | Post to r/mongodb (lead with the DB internals). |
| 9 | MongoDB Community Forums post. |
| 10 | Drop the Discord one-liner in 1–2 showcase channels. |
| 12 | Publish Post 2 (switch guide) on Medium + Dev.to — the long-term SEO piece. |
| 14 | LinkedIn Version B, linking the switch guide. |

The switch guide goes last on purpose: it's the one that keeps pulling Google traffic for months, so it
doesn't need the launch-day burst.
