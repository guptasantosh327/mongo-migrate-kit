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
    alt: mongo-migrate-kit logo
  actions:
    - theme: brand
      text: Start here
      link: /guide/
    - theme: alt
      text: 5-minute quick start
      link: /guide/getting-started
    - theme: alt
      text: GitHub
      link: https://github.com/guptasantosh327/mongo-migrate-kit

features:
  - icon: { src: /icons/one-file.svg, width: 28, height: 28 }
    title: Run one file
    details: "mmk up <file> runs just that migration. Useful when you are testing a single change."
    link: /commands/up
    linkText: mmk up
  - icon: { src: /icons/undo.svg, width: 28, height: 28 }
    title: Undo the right thing
    details: Roll back the last deploy, a batch by number, the last few files, or one file by name. The history stays.
    link: /commands/down
    linkText: mmk down
  - icon: { src: /icons/preview.svg, width: 28, height: 28 }
    title: See it before it runs
    details: mmk dry-run lists what would run and doesn't write anything. Safe to point at production.
    link: /commands/dry-run
    linkText: mmk dry-run
  - icon: { src: /icons/lock.svg, width: 28, height: 28 }
    title: Deploys take turns
    details: A lock in MongoDB lets one run go at a time. A second deploy stops and tells you who holds the lock.
    link: /guide/concepts#the-lock
    linkText: How the lock works
  - icon: { src: /icons/checksum.svg, width: 28, height: 28 }
    title: Edits get noticed
    details: mmk saves a checksum of each file when it runs. If someone edits an applied file later, you'll know.
    link: /guide/concepts#checksums
    linkText: Checksums
  - icon: { src: /icons/import.svg, width: 28, height: 28 }
    title: Easy move from migrate-mongo
    details: mmk import reads your old changelog, so nothing that already ran runs again.
    link: /guide/migrate-mongo
    linkText: Switching guide
---

<div class="home-section">

## See it run

<p class="lead">A preview, a real run, then rolling back one migration by name. This is the actual output.</p>

<Cast name="hero" alt="Terminal: mmk dry-run up lists three pending migrations, mmk up applies them, mmk down rolls back one file by name, and mmk status shows the result" />

## Learn it in four steps

<p class="lead">Start at the top. Each step takes you a bit further, and you can stop whenever you have what you need.</p>

<ol class="path">
  <li>
    <span class="step-title">Get it running</span>
    <span class="step-time">about 10 minutes</span>
    <p>Install it, write your first migration, run it and roll it back.</p>
    <a class="step-link" href="/guide/getting-started">Quick start →</a>
  </li>
  <li>
    <span class="step-title">Understand it</span>
    <span class="step-time">about 15 minutes</span>
    <p>What a batch is, where the history lives, and how the lock and checksums protect you.</p>
    <a class="step-link" href="/guide/concepts">How it works →</a>
  </li>
  <li>
    <span class="step-title">Use it in production</span>
    <span class="step-time">about 30 minutes</span>
    <p>Config, CI pipelines, running on app start, transactions, and what to do when something fails.</p>
    <a class="step-link" href="/guide/ci-cd">Deploying →</a>
  </li>
  <li>
    <span class="step-title">Bigger setups</span>
    <span class="step-time">when you need it</span>
    <p>Several repos on one database, moving off migrate-mongo, and long-running data changes.</p>
    <a class="step-link" href="/guide/shared-database">Sharing a database →</a>
  </li>
</ol>

## Already on migrate-mongo?

<p class="lead">Point mmk at the same database and run <code>mmk import</code>. It copies your history into its own collection and never changes the old one. After that, <code>mmk up</code> only runs what's new.</p>

<Cast name="import" alt="Terminal: mmk import --dry-run previews three migrate-mongo records, mmk import copies them, and mmk up applies only the one new migration" />

[Read the switching guide →](/guide/migrate-mongo)

<br><br>

</div>
