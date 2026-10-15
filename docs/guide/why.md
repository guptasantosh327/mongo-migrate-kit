# Why mongo-migrate-kit?

I built it after a bad Friday. One migration out of three in a release was wrong, and the tool we
used could only roll back "the last one". Fixing it meant connecting to production and undoing the
change by hand. ([The longer story is on the blog](/blog/why-i-built-mongo-migrate-kit).)

So the main idea is simple: you should be able to run, preview and undo exactly the migration you
mean, and the tool should stop you before it does something you didn't expect.

## Reasons to choose it

- **Run a single migration** — `mmk up <file>`, not just "all pending".
- **Roll back anything** — a batch (`--batch 3`), the last N (`--steps 2`), one file, or `redo`.
- **Preview before you run** — `mmk dry-run up` prints the exact plan without touching the database.
- **No race conditions** — an atomic MongoDB lock stops two deploys running migrations at once.
- **Tamper detection** — SHA-256 checksums catch a migration edited after it was applied.
- **Audit trail kept** — a rollback updates the record, it never deletes it.
- **Lifecycle hooks** — `beforeAll`, `afterAll`, `beforeEach`, `afterEach`, `onError`.
- **Opt-in transactions** — wrap a migration so it fully commits or fully aborts.
- **TypeScript, ESM & CommonJS** — all run with no `ts-node` plumbing.
- **Zero config files required** — drive everything from env vars if you prefer.

## Compared with migrate-mongo

migrate-mongo is the tool most Node projects use, and it's a good tool. This table is only about
the features where they differ.

| Capability                                      | `migrate-mongo` | `mongo-migrate-kit` |
| ----------------------------------------------- | :-------------: | :-----------------: |
| Run a single migration file                     |        ❌        |          ✅          |
| Roll back a specific batch (not just the last)  |        ❌        |          ✅          |
| Roll back a single migration file               |        ❌        |          ✅          |
| Dry-run preview                                 |        ❌        |          ✅          |
| `redo` (down + up)                              |        ❌        |          ✅          |
| Concurrency lock on by default                  |        ❌        |          ✅          |
| Refuses to roll back an edited migration        |        ❌        |          ✅          |
| Lifecycle hooks                                 |        ❌        |          ✅          |
| History kept on rollback (never deleted)        |        ❌        |          ✅          |
| Adopt an existing `migrate-mongo` changelog     |        —        |          ✅          |

<p style="font-size:.85rem;color:var(--vp-c-text-2)">Reflects <code>migrate-mongo</code>'s documented CLI as of mid-2026. It also gives migrations transaction access through a <code>client</code> argument; <code>mmk</code> exposes the same plus a declarative per-file <code>useTransaction</code> flag.</p>

If you already use migrate-mongo, you don't have to start over. `mmk import` copies your existing
history, so nothing runs twice. See [Moving from migrate-mongo](/guide/migrate-mongo).

## When it's not the right fit

To be fair about it:

- If you need a schema tool for SQL databases, this isn't it. It only talks to MongoDB.
- If your whole team is happy with migrate-mongo and never needs to undo a specific migration,
  switching may not be worth it.
- If you want migrations generated for you from model changes, mmk doesn't do that. You write the
  `up` and `down` yourself.

## Next

[Quick start](/guide/getting-started) gets you from zero to a migration you can roll back in about
five minutes.
