import { defineConfig } from 'vitepress';

const ogTitle = 'mongo-migrate-kit';
const ogDescription = 'Elegant, fast, TypeScript-first MongoDB migrations for Node.js';
const repo = 'https://github.com/guptasantosh327/mongo-migrate-kit';

// https://vitepress.dev/reference/site-config
export default defineConfig({
  title: 'mongo-migrate-kit',
  description: ogDescription,
  lang: 'en-US',
  cleanUrls: true,
  lastUpdated: true,

  head: [
    ['link', { rel: 'icon', type: 'image/png', href: '/favicon.png' }],
    ['meta', { name: 'theme-color', content: '#00ED64' }],
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:title', content: ogTitle }],
    ['meta', { property: 'og:description', content: ogDescription }],
    ['meta', { name: 'twitter:card', content: 'summary_large_image' }],
  ],

  themeConfig: {
    logo: '/favicon.png',

    // ─── Top navigation ──────────────────────────────────────────────
    nav: [
      { text: 'Guide', link: '/guide/getting-started', activeMatch: '/guide/' },
      { text: 'Commands', link: '/commands/up', activeMatch: '/commands/' },
      {
        text: 'v1.2.1',
        items: [
          { text: 'Changelog', link: `${repo}/blob/main/CHANGELOG.md` },
          { text: 'npm', link: 'https://www.npmjs.com/package/mongo-migrate-kit' },
          { text: 'Releases', link: `${repo}/releases` },
        ],
      },
    ],

    // ─── Sidebar ─────────────────────────────────────────────────────
    sidebar: {
      '/guide/': [
        {
          text: 'Introduction',
          items: [
            { text: 'Why mongo-migrate-kit?', link: '/guide/why' },
            { text: 'Getting Started', link: '/guide/getting-started' },
            { text: 'Configuration', link: '/guide/configuration' },
          ],
        },
        {
          text: 'Core Concepts',
          items: [
            { text: 'Writing Migrations', link: '/guide/writing-migrations' },
            { text: 'Transactions', link: '/guide/transactions' },
            { text: 'Lifecycle Hooks', link: '/guide/hooks' },
            { text: 'Migrating from migrate-mongo', link: '/guide/migrate-mongo' },
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
          text: 'Inspecting & authoring',
          items: [
            { text: 'mmk status / list', link: '/commands/status' },
            { text: 'mmk create / init', link: '/commands/create' },
            { text: 'mmk dry-run', link: '/commands/dry-run' },
          ],
        },
        {
          text: 'Operations',
          items: [
            { text: 'mmk import', link: '/commands/import' },
            { text: 'mmk unlock', link: '/commands/unlock' },
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
      prev: 'Previous page',
      next: 'Next page',
    },
  },
});
