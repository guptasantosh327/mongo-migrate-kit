import type { Theme } from 'vitepress';
import DefaultTheme from 'vitepress/theme';
import { h } from 'vue';
import './custom.css';
import BlogMeta from './BlogMeta.vue';

// Extends the default VitePress theme with our brand styling (see custom.css).
// This is exactly the pattern Pinia / Vite / Vue use to brand their docs —
// the layout/components stay the default theme, the look comes from CSS variables.
// The `doc-before` slot renders the blog byline (author · date · reading time),
// which self-hides on any page without a `date` in frontmatter.
export default {
  extends: DefaultTheme,
  Layout() {
    return h(DefaultTheme.Layout, null, {
      'doc-before': () => h(BlogMeta),
    });
  },
} satisfies Theme;
