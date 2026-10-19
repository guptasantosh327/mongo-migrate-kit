---
title: Start here
description: A short path through the mongo-migrate-kit docs, from your first migration to running it in production.
---

# Start here

mongo-migrate-kit (the command is `mmk`) runs database migrations for MongoDB from Node.js. A
migration is a small file with two functions: `up` makes a change, and `down` undoes it. You keep
these files in your repo next to your code. `mmk` remembers which ones have run on each database,
so every environment ends up with the same changes in the same order.

If you have used Rails, Laravel or Knex migrations, this will feel familiar. If you haven't, that's
fine too. The pages below are written so you can read them in order.

## What you need

- Node.js 18 or newer
- A MongoDB server, version 4.2 or newer. A local one is fine. If you don't have one,
  `docker run -d -p 27017:27017 mongo` starts one.
- About ten minutes for the first step

## The path

<ol class="path">
  <li>
    <span class="step-title">Get it running</span>
    <span class="step-time">about 10 minutes</span>
    <p>Install the package, create a migration, run it, look at the status, and roll it back. The tutorial does the same thing more slowly and explains each step.</p>
    <a class="step-link" href="/guide/getting-started">Quick start →</a><br>
    <a class="step-link" href="/guide/tutorial">Tutorial →</a>
  </li>
  <li>
    <span class="step-title">Understand it</span>
    <span class="step-time">about 15 minutes</span>
    <p>Where mmk keeps its history, what a batch is, how the lock and checksums work, and what a good migration file looks like.</p>
    <a class="step-link" href="/guide/concepts">How it works →</a><br>
    <a class="step-link" href="/guide/writing-migrations">Writing migrations →</a><br>
    <a class="step-link" href="/guide/typescript">TypeScript →</a><br>
    <a class="step-link" href="/guide/workflow">A normal day with mmk →</a><br>
    <a class="step-link" href="/guide/vscode">In VS Code →</a>
  </li>
  <li>
    <span class="step-title">Use it in production</span>
    <span class="step-time">about 30 minutes</span>
    <p>Configuration, running migrations in CI or on app start, transactions, hooks, and reading the errors when something fails.</p>
    <a class="step-link" href="/guide/configuration">Configuration →</a><br>
    <a class="step-link" href="/guide/ci-cd">Deploying and CI →</a><br>
    <a class="step-link" href="/guide/api">Running from your code →</a><br>
    <a class="step-link" href="/guide/troubleshooting">When something goes wrong →</a>
  </li>
  <li>
    <span class="step-title">Bigger setups</span>
    <span class="step-time">read when you need it</span>
    <p>Several repos writing to one database, moving an existing project off migrate-mongo, and longer reads on the blog.</p>
    <a class="step-link" href="/guide/shared-database">Sharing a database →</a><br>
    <a class="step-link" href="/guide/migrate-mongo">Moving from migrate-mongo →</a><br>
    <a class="step-link" href="/blog/">Blog →</a>
  </li>
</ol>

## Looking something up?

You don't have to follow the path. If you already know what you need:

- [CLI cheatsheet](/reference/cli) has every command and flag on one page.
- [Commands](/commands/up) explains each command in detail, with real output.
- [Error codes](/reference/error-codes) lists every error mmk can show and what to do about it.
- [FAQ](/guide/faq) answers the questions people ask most.

## Something unclear?

If a page here confused you, that's a bug in the docs. Please
[open an issue](https://github.com/guptasantosh327/mongo-migrate-kit/issues) or use the
"Edit this page" link at the bottom of any page.
