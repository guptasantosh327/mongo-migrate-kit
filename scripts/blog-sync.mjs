/**
 * Copies the published blog posts (docs/blog/*.md) into the cross-posting drafts (blog/0X-*.md).
 *
 *   node scripts/blog-sync.mjs
 *
 * The docs site is the source of truth. The drafts are what gets pasted into Medium, Dev.to and
 * Hashnode, so this script turns site-only syntax into plain Markdown:
 *   <Cast name="x" alt="…" />      → a GIF from https://mongo-migrate-kit.vercel.app/gifs/x.gif
 *   <Diagram name="x" />           → a PNG from …/diagrams/png/x.png (those sites don't show SVG)
 *   ./slug links                    → ./0X-file.md
 *   /guide/… links                  → absolute links to the docs site
 *   ::: code-group blocks           → labelled plain code blocks
 * The SEO comment at the top of each draft is kept, with its meta description refreshed.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SITE = 'https://mongo-migrate-kit.vercel.app';

const POSTS = {
  '01-why-i-built-mongo-migrate-kit.md': 'why-i-built-mongo-migrate-kit',
  '02-switching-from-migrate-mongo-guide.md': 'switching-from-migrate-mongo',
  '03-7-things-migrate-mongo-cant-do.md': '7-things-migrate-mongo-cant-do',
  '05-rollback-specific-mongodb-migration.md': 'rollback-specific-mongodb-migration',
  '06-mongodb-migration-locking-concurrent-deploys.md': 'mongodb-migration-locking-concurrent-deploys',
  '07-run-migrations-on-startup-serverless.md': 'run-migrations-on-startup-serverless',
  '08-mongodb-migrations-ci-cd-github-actions.md': 'mongodb-migrations-ci-cd-github-actions',
  '09-mongodb-migration-best-practices.md': 'mongodb-migration-best-practices',
};
const FILE_FOR_SLUG = Object.fromEntries(Object.entries(POSTS).map(([file, slug]) => [slug, file]));

const DIAGRAM_ALT = {
  batches: 'Which migrations mmk down, mmk down --batch 2, mmk down --steps 3 and mmk down with a file name undo',
  'how-up-works': 'What happens when you run mmk up',
  'shared-database': 'Two repos, each with its own namespace, sharing one database and one lock',
  transaction: 'A migration failing halfway, with and without a transaction',
  'expand-contract': 'Expand, backfill, contract: renaming a field across three deploys',
};

function convert(body) {
  let out = body
    .replace(/<Cast name="([^"]+)" alt="([^"]+)" \/>/g, (_, name, alt) => `![${alt}](${SITE}/gifs/${name}.gif)`)
    .replace(
      /<Diagram name="([^"]+)"(?: caption="[^"]*")? \/>/g,
      (_, name) => `![${DIAGRAM_ALT[name] ?? name}](${SITE}/diagrams/png/${name}.png)`,
    )
    .replace(/\]\(\.\/([a-z0-9-]+)\)/g, (all, slug) => (FILE_FOR_SLUG[slug] ? `](./${FILE_FOR_SLUG[slug]})` : all))
    .replace(/\]\(\/(guide|commands|reference|blog)([^)]*)\)/g, (_, section, rest) => `](${SITE}/${section}${rest})`);

  const lines = [];
  let inGroup = false;
  for (const line of out.split('\n')) {
    if (line.trim() === '::: code-group') {
      inGroup = true;
      continue;
    }
    if (inGroup && line.trim() === ':::') {
      inGroup = false;
      continue;
    }
    const fence = /^```(\w+) \[(.+)\]$/.exec(line);
    if (inGroup && fence) {
      lines.push(`**${fence[2]}:**`, '', `\`\`\`${fence[1]}`);
      continue;
    }
    lines.push(line);
  }
  out = lines.join('\n');
  return out;
}

function wrap(prefix, text, width = 100) {
  const rows = [];
  let row = prefix;
  for (const word of text.split(/\s+/)) {
    if (row.length + 1 + word.length > width) {
      rows.push(row);
      row = word;
    } else {
      row += ` ${word}`;
    }
  }
  rows.push(row);
  return rows.join('\n');
}

for (const [file, slug] of Object.entries(POSTS)) {
  const site = readFileSync(join(repo, 'docs/blog', `${slug}.md`), 'utf8');
  const fm = /^---\n([\s\S]*?)\n---\n/.exec(site);
  const description = /^description: "(.*)"$/m.exec(fm[1])[1];
  const body = site.slice(fm[0].length).replace(/^\n+/, '');
  const draftPath = join(repo, 'blog', file);
  const old = readFileSync(draftPath, 'utf8');
  const keyword = /SEO target keyword: (.*)/.exec(old)?.[1];
  const header = [
    '<!--',
    ...(keyword ? [`SEO target keyword: ${keyword}`] : []),
    wrap('Meta description:', description),
    `Published copy: docs/blog/${slug}.md (edit that one first, then run node scripts/blog-sync.mjs).`,
    '-->',
    '',
    '',
  ].join('\n');
  writeFileSync(draftPath, header + convert(body));
  console.log(`synced ${file}`);
}
