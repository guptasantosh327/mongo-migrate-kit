import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig } from 'vitepress';

const authorName = 'Santosh Gupta';

/** True for a publishable blog post page (excludes the /blog/ index). */
function isBlogPost(relativePath: string): boolean {
  return relativePath.startsWith('blog/') && relativePath !== 'blog/index.md';
}

/** Normalize a front-matter date (YAML may parse it as a Date or a string) to `YYYY-MM-DD`. */
function toISODate(value: unknown): string | undefined {
  if (!value) return undefined;
  const d = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(+d) ? undefined : d.toISOString().slice(0, 10);
}

/** Estimate reading time (minutes) from a page's raw markdown, front-matter stripped. */
function readingMinutes(relativePath: string): number | undefined {
  try {
    const src = readFileSync(join(process.cwd(), 'docs', relativePath), 'utf8');
    const words = src
      .replace(/^---[\s\S]*?---/, '')
      .split(/\s+/)
      .filter(Boolean).length;
    return Math.max(1, Math.round(words / 200));
  } catch {
    return undefined;
  }
}

/** Escape the five XML predefined entities for safe inclusion in feed text. */
function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

interface FeedItem {
  title: string;
  description: string;
  slug: string;
  date: Date;
}

/** Pull one front-matter value (unquoted, unescaped) from a raw markdown source. */
function frontmatterValue(src: string, key: string): string | undefined {
  const match = src.match(new RegExp(`^${key}:\\s*(.*)$`, 'm'));
  if (!match) return undefined;
  return match[1]
    .trim()
    .replace(/^["']|["']$/g, '')
    .replace(/\\"/g, '"');
}

/** Read every publishable blog post's front-matter, newest first. */
function collectBlogPosts(): FeedItem[] {
  const dir = join(process.cwd(), 'docs', 'blog');
  return readdirSync(dir)
    .filter((f) => f.endsWith('.md') && f !== 'index.md')
    .map((file) => {
      const src = readFileSync(join(dir, file), 'utf8');
      const rawDate = frontmatterValue(src, 'date');
      return {
        title: frontmatterValue(src, 'title') ?? file.replace(/\.md$/, ''),
        description: frontmatterValue(src, 'description') ?? '',
        slug: file.replace(/\.md$/, ''),
        date: rawDate ? new Date(rawDate) : new Date(0),
      };
    })
    .sort((a, b) => +b.date - +a.date);
}

/** Write an RSS 2.0 feed of the blog to <outDir>/blog/feed.xml at build time. */
function writeRssFeed(outDir: string): void {
  const posts = collectBlogPosts();
  const blogUrl = `${hostname}blog/`;
  const feedUrl = `${blogUrl}feed.xml`;
  const now = new Date().toUTCString();

  const items = posts
    .map((post) => {
      const url = `${hostname}blog/${post.slug}`;
      return [
        '    <item>',
        `      <title>${escapeXml(post.title)}</title>`,
        `      <link>${url}</link>`,
        `      <guid isPermaLink="true">${url}</guid>`,
        `      <pubDate>${post.date.toUTCString()}</pubDate>`,
        `      <description>${escapeXml(post.description)}</description>`,
        '    </item>',
      ].join('\n');
    })
    .join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>mongo-migrate-kit blog</title>
    <link>${blogUrl}</link>
    <description>Notes on running MongoDB migrations: rollbacks, locking, transactions, CI/CD and habits that keep production safe.</description>
    <language>en-US</language>
    <lastBuildDate>${now}</lastBuildDate>
    <atom:link href="${feedUrl}" rel="self" type="application/rss+xml"/>
${items}
  </channel>
</rss>
`;

  writeFileSync(join(outDir, 'blog', 'feed.xml'), xml, 'utf8');
}

const ogTitle = 'mongo-migrate-kit: MongoDB migrations for Node.js';
const ogDescription =
  'MongoDB migrations for Node.js and TypeScript. Run one migration, roll back any batch ' +
  'or file, preview with dry-run, and stop two deploys from running at once.';
const repo = 'https://github.com/guptasantosh327/mongo-migrate-kit';
const base = '/';
const hostname = 'https://mongo-migrate-kit.vercel.app/';
const ogImage = `${hostname}logo.png`;

const keywords = [
  'mongodb migration',
  'mongodb migrations',
  'mongo migration',
  'mongodb migration tool',
  'mongodb migration nodejs',
  'mongodb migration typescript',
  'node mongodb migration',
  'database migration mongodb',
  'schema migration mongodb',
  'migrate-mongo alternative',
  'mongoose migration',
  'mongodb migration cli',
  'mmk',
  'mongo-migrate-kit',
].join(', ');

// schema.org structured data — helps search and AI engines understand the package
// as a software entity, not just text on a page.
const jsonLd = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: 'mongo-migrate-kit',
  alternateName: 'mmk',
  description: ogDescription,
  applicationCategory: 'DeveloperApplication',
  operatingSystem: 'Node.js >= 18',
  url: hostname,
  downloadUrl: 'https://www.npmjs.com/package/mongo-migrate-kit',
  codeRepository: repo,
  license: 'https://opensource.org/licenses/MIT',
  keywords,
  author: { '@type': 'Person', name: 'Santosh Gupta' },
  offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
};

// https://vitepress.dev/reference/site-config
export default defineConfig({
  title: 'mongo-migrate-kit',
  titleTemplate: ':title | MongoDB migrations for Node.js',
  description: ogDescription,
  lang: 'en-US',
  base,
  cleanUrls: true,
  lastUpdated: true,
  sitemap: { hostname },

  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: `${base}logo-mark.svg` }],
    ['link', { rel: 'icon', type: 'image/png', href: `${base}favicon.png` }],
    ['meta', { name: 'theme-color', content: '#00ED64' }],
    ['meta', { name: 'author', content: 'Santosh Gupta' }],
    ['meta', { name: 'keywords', content: keywords }],
    ['meta', { name: 'robots', content: 'index, follow' }],
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:site_name', content: 'mongo-migrate-kit' }],
    ['meta', { property: 'og:title', content: ogTitle }],
    ['meta', { property: 'og:description', content: ogDescription }],
    ['meta', { property: 'og:image', content: ogImage }],
    ['meta', { name: 'twitter:card', content: 'summary_large_image' }],
    ['meta', { name: 'twitter:title', content: ogTitle }],
    ['meta', { name: 'twitter:description', content: ogDescription }],
    ['meta', { name: 'twitter:image', content: ogImage }],
    ['script', { type: 'application/ld+json' }, JSON.stringify(jsonLd)],
    // RSS auto-discovery — lets feed readers find the blog feed from any page.
    [
      'link',
      {
        rel: 'alternate',
        type: 'application/rss+xml',
        title: 'mongo-migrate-kit blog',
        href: `${hostname}blog/feed.xml`,
      },
    ],
  ],

  // Per-page canonical + og:url for clean SEO indexing
  transformPageData(pageData) {
    const path = pageData.relativePath.replace(/index\.md$/, '').replace(/\.md$/, '');
    const canonical = `${hostname}${path}`;
    const fm = pageData.frontmatter;
    fm.head ??= [];
    fm.head.push(
      ['link', { rel: 'canonical', href: canonical }],
      ['meta', { property: 'og:url', content: canonical }],
    );

    // ─── Blog posts: reading time + Article structured data (rich-result SEO) ──
    if (!isBlogPost(pageData.relativePath)) return;

    fm.readingTime = readingMinutes(pageData.relativePath);
    const published = toISODate(fm.date);
    const author = typeof fm.author === 'string' ? fm.author : authorName;

    const articleLd = {
      '@context': 'https://schema.org',
      '@type': 'BlogPosting',
      headline: fm.title,
      description: fm.description,
      url: canonical,
      mainEntityOfPage: { '@type': 'WebPage', '@id': canonical },
      image: ogImage,
      inLanguage: 'en-US',
      author: { '@type': 'Person', name: author },
      publisher: {
        '@type': 'Organization',
        name: 'mongo-migrate-kit',
        logo: { '@type': 'ImageObject', url: `${hostname}logo.png` },
      },
      ...(published ? { datePublished: published, dateModified: published } : {}),
      keywords,
    };

    fm.head.push(
      ['meta', { property: 'article:author', content: author }],
      ['meta', { property: 'article:section', content: 'MongoDB' }],
      ...(published
        ? ([['meta', { property: 'article:published_time', content: published }]] as const)
        : []),
      ['script', { type: 'application/ld+json' }, JSON.stringify(articleLd)],
    );
  },

  // Blog posts are articles, not the site's default `website` og:type.
  transformHead({ pageData, head }) {
    if (!isBlogPost(pageData.relativePath)) return head;
    return head.map((tag) =>
      tag[0] === 'meta' && tag[1]?.property === 'og:type'
        ? (['meta', { property: 'og:type', content: 'article' }] as (typeof head)[number])
        : tag,
    );
  },

  // Emit the blog RSS feed into the built site.
  buildEnd(siteConfig) {
    writeRssFeed(siteConfig.outDir);
  },

  themeConfig: {
    logo: '/logo-mark.svg',

    // ─── Top navigation ──────────────────────────────────────────────
    nav: [
      { text: 'Guide', link: '/guide/', activeMatch: '/guide/' },
      { text: 'Commands', link: '/commands/up', activeMatch: '/commands/' },
      { text: 'Reference', link: '/reference/cli', activeMatch: '/reference/' },
      { text: 'Blog', link: '/blog/', activeMatch: '/blog/' },
      {
        text: 'v1.5.0',
        items: [
          { text: 'Changelog', link: `${repo}/blob/main/CHANGELOG.md` },
          { text: 'npm', link: 'https://www.npmjs.com/package/mongo-migrate-kit' },
          { text: 'Releases', link: `${repo}/releases` },
        ],
      },
    ],

    // ─── Sidebar ─────────────────────────────────────────────────────
    // The guide is ordered as a learning path: each group builds on the one above it,
    // and the prev/next links at the bottom of every page follow the same order.
    sidebar: {
      '/guide/': [
        {
          text: '1. Get it running',
          items: [
            { text: 'Start here', link: '/guide/' },
            { text: 'Why mongo-migrate-kit?', link: '/guide/why' },
            { text: 'Quick start', link: '/guide/getting-started' },
            { text: 'Tutorial: your first migration', link: '/guide/tutorial' },
          ],
        },
        {
          text: '2. Understand it',
          items: [
            { text: 'How it works', link: '/guide/concepts' },
            { text: 'Writing migrations', link: '/guide/writing-migrations' },
            { text: 'A normal day with mmk', link: '/guide/workflow' },
          ],
        },
        {
          text: '3. Use it in production',
          items: [
            { text: 'Configuration', link: '/guide/configuration' },
            { text: 'Deploying and CI', link: '/guide/ci-cd' },
            { text: 'Running from your code', link: '/guide/api' },
            { text: 'Transactions', link: '/guide/transactions' },
            { text: 'Hooks', link: '/guide/hooks' },
            { text: 'When something goes wrong', link: '/guide/troubleshooting' },
          ],
        },
        {
          text: '4. Bigger setups',
          items: [
            { text: 'Sharing a database', link: '/guide/shared-database' },
            { text: 'Moving from migrate-mongo', link: '/guide/migrate-mongo' },
            { text: 'FAQ', link: '/guide/faq' },
          ],
        },
      ],
      '/blog/': [
        {
          text: 'Blog',
          items: [
            { text: 'All posts', link: '/blog/' },
            { text: 'Why I built mongo-migrate-kit', link: '/blog/why-i-built-mongo-migrate-kit' },
            { text: 'Rolling back one migration', link: '/blog/rollback-specific-mongodb-migration' },
            { text: 'Switching from migrate-mongo', link: '/blog/switching-from-migrate-mongo' },
            { text: "7 things migrate-mongo can't do", link: '/blog/7-things-migrate-mongo-cant-do' },
            {
              text: 'Locking for concurrent deploys',
              link: '/blog/mongodb-migration-locking-concurrent-deploys',
            },
            {
              text: 'Migrations on app start and serverless',
              link: '/blog/run-migrations-on-startup-serverless',
            },
            {
              text: 'Migrations in GitHub Actions',
              link: '/blog/mongodb-migrations-ci-cd-github-actions',
            },
            { text: 'Habits for safe migrations', link: '/blog/mongodb-migration-best-practices' },
          ],
        },
      ],
      '/reference/': [
        {
          text: 'Reference',
          items: [
            { text: 'CLI cheatsheet', link: '/reference/cli' },
            { text: 'Error codes', link: '/reference/error-codes' },
          ],
        },
      ],
      '/commands/': [
        {
          text: 'Running migrations',
          items: [
            { text: 'mmk up', link: '/commands/up' },
            { text: 'mmk down', link: '/commands/down' },
            { text: 'mmk redo', link: '/commands/redo' },
          ],
        },
        {
          text: 'Looking around',
          items: [
            { text: 'mmk status / list', link: '/commands/status' },
            { text: 'mmk dry-run', link: '/commands/dry-run' },
          ],
        },
        {
          text: 'Creating files',
          items: [{ text: 'mmk create / init', link: '/commands/create' }],
        },
        {
          text: 'Maintenance',
          items: [
            { text: 'mmk import', link: '/commands/import' },
            { text: 'mmk unlock', link: '/commands/unlock' },
            { text: 'mmk namespace adopt', link: '/commands/namespace' },
          ],
        },
      ],
    },

    // ─── Local, zero-config full-text search ─────────────────────────
    search: { provider: 'local' },

    socialLinks: [{ icon: 'github', link: repo }],

    editLink: {
      pattern: `${repo}/edit/main/docs/:path`,
      text: 'Edit this page on GitHub',
    },

    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Copyright © 2026 Santosh Gupta',
    },

    docFooter: {
      prev: 'Back',
      next: 'Next',
    },

    outline: { level: [2, 3], label: 'On this page' },
  },
});
