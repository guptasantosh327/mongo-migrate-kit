import type { Theme } from 'vitepress';
import DefaultTheme from 'vitepress/theme';
import { h } from 'vue';
import './custom.css';
import BlogMeta from './BlogMeta.vue';
import Cast from './Cast.vue';
import Diagram from './Diagram.vue';

// Extends the default VitePress theme with our brand styling (see custom.css).
// The `doc-before` slot renders the blog byline (author · date · reading time),
// which hides itself on any page without a `date` in frontmatter.
// <Cast> and <Diagram> are available in every markdown page.
export default {
  extends: DefaultTheme,
  Layout() {
    return h(DefaultTheme.Layout, null, {
      'doc-before': () => h(BlogMeta),
    });
  },
  enhanceApp({ app }) {
    app.component('Cast', Cast);
    app.component('Diagram', Diagram);
  },
} satisfies Theme;
