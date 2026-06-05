---
layout: home

title: mongo-migrate-kit
titleTemplate: Elegant MongoDB migrations for Node.js

hero:
  name: mongo-migrate-kit
  text: Elegant MongoDB migrations for Node.js
  tagline: Precise, safe migrations for MongoDB. Run a single file, roll back anything, and preview every change before it touches your database.
  image:
    src: /logo-mark.svg
    alt: mongo-migrate-kit
  actions:
    - theme: brand
      text: Get Started
      link: /guide/getting-started
    - theme: alt
      text: Why mongo-migrate-kit?
      link: /guide/why
    - theme: alt
      text: View on GitHub
      link: https://github.com/guptasantosh327/mongo-migrate-kit

features:
  - icon: 🎯
    title: Run a single file
    details: mmk up <file> and mmk down <file> — not just "all pending" or "the last batch". Full control over exactly what runs.
    link: /commands/up
    linkText: mmk up
  - icon: ↩️
    title: Real rollbacks
    details: Revert any batch (--batch 3), the last N migrations (--steps 2), a single file, or redo in one step — history is never deleted.
    link: /commands/down
    linkText: mmk down
  - icon: 👀
    title: Dry-run previews
    details: mmk dry-run up shows precisely what would run before anything touches the database. No surprises in production.
    link: /commands/dry-run
    linkText: mmk dry-run
  - icon: 🔒
    title: Safe by default
    details: An atomic MongoDB lock with a renewal heartbeat stops two deploys racing, and SHA-256 checksums catch edited migrations before they re-run.
    link: /commands/unlock
    linkText: Locking & unlock
  - icon: 🔐
    title: Opt-in transactions
    details: Wrap a migration in a MongoDB transaction with export const useTransaction = true — automatic commit on success, abort on error.
    link: /guide/transactions
    linkText: Transactions
  - icon: 🪝
    title: Lifecycle hooks
    details: beforeAll, afterAll, beforeEach, afterEach, and onError — plug in logging, metrics, or notifications around every run.
    link: /guide/hooks
    linkText: Lifecycle hooks
  - icon: 🧾
    title: Audit-ready history
    details: Every run records duration, checksum, environment, user, and batch in an append-only changelog. A rollback updates the record, never removes it.
    link: /commands/status
    linkText: mmk status
  - icon: 📘
    title: TypeScript & JavaScript
    details: .ts (native on Node 22.18+, or via a loader like tsx), ESM, and CommonJS all just work, with a fully-typed context and config.
    link: /guide/writing-migrations
    linkText: Writing migrations
  - icon: 📦
    title: Adopt migrate-mongo
    details: mmk import brings an existing migrate-mongo changelog forward as-is — no re-running, no data loss, no rewriting files.
    link: /guide/migrate-mongo
    linkText: Migrate from migrate-mongo
---
