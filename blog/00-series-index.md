<!--
SERIES INDEX: internal planning doc, not meant to be published as-is.
Purpose: map the whole content cluster so the posts interlink correctly and each
one targets a distinct search query (no cannibalization).
-->

# mongo-migrate-kit: blog series map

This is the planning map for the whole content cluster. It exists so the posts **interlink
deliberately** (the thing that actually moves SEO and sends people to the docs/npm) instead of
being nine disconnected articles.

The model is a classic **topic cluster**: one pillar post plus supporting posts. Every supporting
post links *up* to the pillar and *sideways* to 1–2 siblings. The pillar links *down* to every
supporting post. Search engines read that internal link graph as "this site is the authority on
MongoDB migrations," and readers follow the links to the docs and npm.

## The cluster

| # | File | Target search query (primary keyword) | Intent |
|---|------|----------------------------------------|--------|
| **Pillar** | `01-why-i-built-mongo-migrate-kit.md` | "migrate-mongo alternative" / "new mongodb migration tool" | Story + overview, the hub |
| 02 | `02-switching-from-migrate-mongo-guide.md` | "switch from migrate-mongo" / "migrate-mongo migration guide" | How-to / transactional |
| 03 | `03-7-things-migrate-mongo-cant-do.md` | "migrate-mongo limitations" | Listicle / awareness |
| 05 | `05-rollback-specific-mongodb-migration.md` | "how to rollback a single mongodb migration" | High-intent how-to |
| 06 | `06-mongodb-migration-locking-concurrent-deploys.md` | "mongodb migration lock concurrent deploys" | Technical deep-dive |
| 07 | `07-run-migrations-on-startup-serverless.md` | "run mongodb migrations on app startup nodejs" | How-to / programmatic |
| 08 | `08-mongodb-migrations-ci-cd-github-actions.md` | "mongodb migrations ci cd github actions" | How-to / DevOps |
| 09 | `09-mongodb-migration-best-practices.md` | "mongodb migration best practices" | Evergreen / broad |

(`04-distribution-kit.md` is the cross-posting playbook, not a public article.)

### Cluster 2: shared databases (v1.5)

Pillar: **10**. Every post links up to 10, sideways to 1–2 siblings, and to the docs + npm. 10 links
down to all of them. They describe 1.5 behaviour and went live on the docs site with the 1.5.0
release.

| # | File | Target search query | Intent |
|---|------|---------------------|--------|
| **Pillar** | `10-mongodb-migrations-shared-database-many-repos.md` | "mongodb migrations shared database multiple services" | Problem + answer, the hub |
| 11 | `11-mongo-migrate-kit-single-repo-no-namespace.md` | "mongo-migrate-kit namespace do I need it" | Reassurance |
| 12 | `12-multiple-repos-same-mongodb-database-migrations.md` | "multiple repos same mongodb database migrations" | How-to |
| 13 | `13-several-products-one-mongodb-database.md` | "mongodb migration collection per service" | How-to / permissions |
| 14 | `14-rolling-out-mongodb-migrations-50-microservices.md` | "mongodb migrations many microservices" | Playbook |
| 15 | `15-add-namespace-existing-repo-migrations.md` | "split shared migrations collection" | How-to |
| 16 | `16-mongodb-migration-lock-multiple-services.md` | "mongodb migration lock multiple services" | Deep-dive |
| 17 | `17-mongodb-migration-namespace-mistakes.md` | "mongodb migration namespace mistakes" | Reference |
| 18 | `18-mongodb-migrations-monorepo-nodejs.md` | "mongodb migrations monorepo nodejs" | How-to |
| 19 | `19-migrate-mongo-shared-changelog-multiple-services.md` | "migrate-mongo shared changelog multiple services" | How-to / switching |
| 20 | `20-mongo-migrate-kit-service-vs-namespace.md` | "mongo-migrate-kit service namespace" | Deprecation notice |

### Cluster 3: setups (any version ≥ 1.4)

One post per kind of user. Each links up to the original pillar (**01**), sideways to 1–2 siblings
or older posts, and to the docs + npm. Published on the docs site with the 1.5.0 release (23 and 25
describe 1.5's CommonJS-aware `mmk init`/`mmk create`).

| # | File | Target search query | Intent |
|---|------|---------------------|--------|
| 21 | `21-mongodb-migrations-database-per-tenant.md` | "mongodb migrations multi tenant" | How-to |
| 22 | `22-mongodb-migrations-kubernetes-job-helm.md` | "mongodb migrations kubernetes" | How-to / DevOps |
| 23 | `23-typescript-commonjs-esm-mongodb-migrations.md` | "typescript mongodb migrations" | How-to / troubleshooting |
| 24 | `24-mongoose-migrations-mongodb.md` | "mongoose migrations" | Opinion + how-to |
| 25 | `25-mongodb-connection-string-secrets-manager-migrations.md` | "mongodb connection string secrets manager" | How-to |
| 26 | `26-mongodb-backfill-migration-large-collection.md` | "mongodb backfill large collection migration" | Technical how-to |
| 27 | `27-test-mongodb-migrations-vitest-memory-server.md` | "test mongodb migrations" | How-to |
| 28 | `28-zero-downtime-mongodb-schema-changes-expand-contract.md` | "mongodb zero downtime migration" | Evergreen / pattern |

All command output in 10–28 was re-checked against the final 1.5.0 build before publishing
(hostnames, users and dates tidied). Re-run anything whose behaviour changes in a later release.

## The interlink rules (don't skip these, they're the point)

1. **Every post links to the pillar (01)** with anchor text close to "why I built mongo-migrate-kit"
   or "migrate-mongo alternative."
2. **Every post links to the canonical docs** at https://mongo-migrate-kit.vercel.app and to
   **npm: mongo-migrate-kit** at least once.
3. **Each post has a "Related reading" block** at the bottom linking 2 siblings (already added).
4. When you publish, replace the relative `./0X-...md` links with the **real published URLs**.
5. **Pick ONE canonical home** for each post (your own blog/docs site is best). When you cross-post
   to Dev.to/Medium/Hashnode/Reddit, set `canonical_url` to the original so you don't compete with
   yourself. See `04-distribution-kit.md`.

## Suggested publishing cadence

Don't publish all nine at once. Search engines and people both reward a steady pace.

- **Week 1:** Pillar (01).
- **Week 2:** 05 (single-file rollback, the strongest and most-searched pain point).
- **Week 3:** 02 (switching guide).
- **Week 4:** 03 (the list, good for social and Reddit).
- **Week 5:** 06 (locking).
- **Week 6:** 07 (startup/serverless).
- **Week 7:** 08 (CI/CD).
- **Week 8:** 09 (best practices, the evergreen one that links to everything).

After each goes live, go back and update the older posts' "Related reading" links to point at the
newly published URL. The cluster gets stronger every week.

## Backlink opportunities (where to drop links, honestly)

- The open `migrate-mongo` dry-run issue (#43) and similar threads: answer the question, link as
  "I ended up building X to solve this."
- Reddit r/node, r/mongodb, r/webdev: share the *story* post, not the landing page.
- The MongoDB community forum.
- Stack Overflow answers to "rollback single mongodb migration" type questions.
- "Awesome MongoDB" / "awesome Node" GitHub lists (open a PR).
- Be a person sharing a tool, not a brand. Reply to every comment.

## Writing style (keep every post sounding like a person)

The published posts and the docs were rewritten in October 2026 to read like one developer talking,
not like generated copy. Keep new posts the same way:

- Short sentences and plain words. "Use", not "leverage". "Safe", not "robust".
- Almost no em dashes. Use a full stop, a comma, a colon or brackets instead.
- No stock phrases: "Here's the thing", "That's it.", "Let's dive in", "game-changer", "seamless",
  "look before you leap", "the medicine became the disease".
- Sentence-case titles ("How to roll back a single MongoDB migration"), not Title Case.
- Be fair to migrate-mongo. Check its README before claiming it can't do something (it has an
  optional lock, `down --block`, and `useFileHash`).
- Show real output. Re-record it with `node scripts/casts/record.mjs` rather than typing it by hand,
  and add a GIF or diagram where a picture explains faster than a paragraph.
- Bold only what someone skimming must not miss. Not every list item needs a bold label.
- Images: posts on the docs site use `<Cast>` and `<Diagram>`. Drafts here use the GIF/PNG URLs,
  because Medium, Dev.to and LinkedIn don't show SVG.
- Every post except 04 has a published copy under `docs/blog/`. Edit that one, then run
  `node scripts/blog-sync.mjs` to update the drafts here.
