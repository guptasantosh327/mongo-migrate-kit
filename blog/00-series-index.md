<!--
SERIES INDEX — internal planning doc, not meant to be published as-is.
Purpose: map the whole content cluster so the posts interlink correctly and each
one targets a distinct search query (no cannibalization).
-->

# mongo-migrate-kit — Blog Series Map

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

## The interlink rules (do not skip — this is the whole point)

1. **Every post links to the pillar (01)** with anchor text close to "why I built mongo-migrate-kit"
   or "migrate-mongo alternative."
2. **Every post links to the canonical docs** at https://mongo-migrate-kit.vercel.app and to
   **npm: mongo-migrate-kit** at least once.
3. **Each post has a "Related reading" block** at the bottom linking 2 siblings (already added).
4. When you publish, replace the relative `./0X-...md` links with the **real published URLs**.
5. **Pick ONE canonical home** for each post (your own blog/docs site is best). When you cross-post
   to Dev.to/Medium/Hashnode/Reddit, set `canonical_url` to the original so you don't compete with
   yourself — see `04-distribution-kit.md`.

## Suggested publishing cadence

Don't dump all nine at once — search engines and humans both reward steady output.

- **Week 1:** Pillar (01).
- **Week 2:** 05 (single-file rollback — your strongest, most-searched pain point).
- **Week 3:** 02 (switching guide).
- **Week 4:** 03 (listicle — good for social/Reddit).
- **Week 5:** 06 (locking).
- **Week 6:** 07 (startup/serverless).
- **Week 7:** 08 (CI/CD).
- **Week 8:** 09 (best practices — the evergreen capstone, links to everything).

After each goes live, go back and update the older posts' "Related reading" links to point at the
newly published URL. The cluster gets stronger every week.

## Backlink opportunities (where to drop links, honestly)

- The open `migrate-mongo` dry-run issue (#43) and similar threads — answer the question, link as
  "I ended up building X to solve this."
- Reddit r/node, r/mongodb, r/webdev — share the *story* post, not the landing page.
- The MongoDB community forum.
- Stack Overflow answers to "rollback single mongodb migration" type questions.
- "Awesome MongoDB" / "awesome Node" GitHub lists (open a PR).
- Be a person sharing a tool, not a brand. Reply to every comment.
