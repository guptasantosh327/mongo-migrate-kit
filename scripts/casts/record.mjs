/**
 * Records the terminal casts used in the docs and README.
 *
 *   npm run build            # the casts run the real dist/mmk.cjs
 *   node scripts/casts/record.mjs            # every scene
 *   node scripts/casts/record.mjs rollback   # just one
 *
 * Every scene starts an in-memory MongoDB (the same one the test suite uses), makes a fresh
 * project folder, runs real `mmk` commands in it and keeps their real output. Nothing in a cast
 * is typed by hand except the commands themselves. Temp paths, the URI, the host name and the OS
 * user are swapped for stable demo values so the pictures don't change on every run.
 *
 * Output: docs/public/casts/<scene>.svg, plus a plain-text transcript next to this file under
 * .transcripts/ (git-ignored) that is handy when copying output into a page.
 */
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { hostname, tmpdir, userInfo } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MongoClient } from 'mongodb';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { renderCast } from './render.mjs';
import { scenes } from './scenes.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../..');
const bin = join(repo, 'dist/mmk.cjs');
const outDir = join(repo, 'docs/public/casts');
const transcriptDir = join(here, '.transcripts');

const DEMO_URI = 'mongodb://localhost:27017';
const DEMO_HOME = '/home/asha';

function makeScrubber(ctx) {
  const pairs = [
    [ctx.uri, DEMO_URI],
    [ctx.realDir, `${DEMO_HOME}/${ctx.folder}`],
    [ctx.dir, `${DEMO_HOME}/${ctx.folder}`],
    [`${ctx.dbName}.`, `${ctx.displayDb}.`],
    [`"${ctx.dbName}"`, `"${ctx.displayDb}"`],
    [hostname(), ctx.host ?? 'asha-mbp'],
    [userInfo().username, 'asha'],
  ];
  return (text) => {
    let s = text;
    for (const [from, to] of pairs) if (from) s = s.split(from).join(to);
    // The memory server's replica-set URI sometimes surfaces without the query string.
    s = s.replace(/mongodb:\/\/127\.0\.0\.1:\d+\/?(\?replicaSet=\w+)?/g, DEMO_URI);
    return s;
  };
}

/** Turn raw combined stdout+stderr into cast output items. */
function toOutput(raw, scrub) {
  const items = [];
  const lines = scrub(raw).replace(/\r/g, '').split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  for (const line of lines) {
    // ora prints "- text…" once when it is not attached to a TTY. In a real terminal that line is
    // an animated spinner that disappears, so the cast shows it as one.
    const spin = /^- (.+…)$/.exec(line);
    if (spin) items.push({ spinner: spin[1] });
    else items.push({ line });
  }
  return items;
}

function env(ctx, extra = {}) {
  return {
    ...process.env,
    FORCE_COLOR: '1',
    MMK_URI: ctx.uri,
    MMK_DB: ctx.dbName,
    MMK_AUTHOR: 'Asha Rao',
    NODE_ENV: 'production',
    ...ctx.env,
    ...extra,
  };
}

/** Build the shell command for one typed line: `npx mmk …` runs the built CLI. */
function shellFor(text) {
  return text.replace(/(^|[;&|]\s*)npx mmk\b/g, `$1node ${JSON.stringify(bin)}`);
}

function runSync(ctx, text, extraEnv) {
  const r = spawnSync('/bin/sh', ['-c', `exec 2>&1; ${shellFor(text)}`], {
    cwd: ctx.dir,
    env: env(ctx, extraEnv),
    encoding: 'utf8',
  });
  return r.stdout;
}

function runAsync(ctx, text, extraEnv) {
  return new Promise((done) => {
    const child = spawn('/bin/sh', ['-c', `exec 2>&1; ${shellFor(text)}`], {
      cwd: ctx.dir,
      env: env(ctx, extraEnv),
    });
    let out = '';
    child.stdout.on('data', (d) => {
      out += d;
    });
    child.on('close', () => done(out));
  });
}

async function recordScene(scene, replSet, client) {
  const folder = scene.folder ?? 'shop-api';
  const base = mkdtempSync(join(tmpdir(), 'mmk-cast-'));
  const dir = join(base, folder);
  mkdirSync(dir, { recursive: true });
  const dbName = `cast_${scene.name.replace(/\W/g, '_')}`;
  await client.db(dbName).dropDatabase();
  const ctx = {
    dir,
    realDir: realpathSync(dir),
    folder,
    uri: replSet.getUri(),
    dbName,
    displayDb: scene.displayDb ?? 'shop',
    db: client.db(dbName),
    env: {},
    host: scene.host,
    write(rel, content) {
      const file = join(dir, rel);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, content);
    },
    sh(text, extraEnv) {
      return runSync(ctx, text, extraEnv);
    },
  };
  const scrub = makeScrubber(ctx);
  ctx.output = (raw) => toOutput(raw, scrub);
  ctx.runAsync = (text, extraEnv) => runAsync(ctx, text, extraEnv);

  if (scene.setup) await scene.setup(ctx);

  let panes;
  if (scene.record) {
    panes = await scene.record(ctx);
  } else {
    const entries = [];
    for (const step of scene.steps) {
      if (step.hidden) {
        if (typeof step.hidden === 'function') await step.hidden(ctx);
        else ctx.sh(step.hidden);
        continue;
      }
      if (step.comment) {
        entries.push({ text: step.comment, comment: true, hold: step.hold });
        continue;
      }
      const cmd = typeof step.cmd === 'function' ? step.cmd(ctx) : step.cmd;
      const raw = ctx.sh(step.run ?? cmd, step.env);
      entries.push({ text: cmd, output: ctx.output(raw), hold: step.hold });
    }
    panes = [{ entries }];
  }

  const cast = {
    title: scene.title ?? `~/${folder}`,
    alt: scene.alt,
    rows: scene.rows,
    cols: scene.cols ?? 104,
    layout: scene.layout,
    minCols: scene.minCols,
    static: scene.static,
    panes,
  };
  writeFileSync(join(outDir, `${scene.name}.svg`), renderCast(cast));

  const plain = panes
    .map((p) =>
      [
        p.label ? `### ${p.label}` : '',
        ...p.entries.flatMap((e) => [
          `$ ${e.text}`,
          ...(e.output ?? [])
            .filter((o) => o.line != null)
            .map((o) => o.line.replace(/\x1b\[[0-9;]*m/g, '')),
        ]),
      ].join('\n'),
    )
    .join('\n\n');
  writeFileSync(join(transcriptDir, `${scene.name}.txt`), `${plain}\n`);
  rmSync(base, { recursive: true, force: true });
}

const only = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
mkdirSync(transcriptDir, { recursive: true });

const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
const client = new MongoClient(replSet.getUri());
await client.connect();
try {
  for (const scene of scenes) {
    if (only.length > 0 && !only.includes(scene.name)) continue;
    process.stdout.write(`recording ${scene.name}… `);
    await recordScene(scene, replSet, client);
    process.stdout.write('done\n');
  }
} finally {
  await client.close();
  await replSet.stop();
}

