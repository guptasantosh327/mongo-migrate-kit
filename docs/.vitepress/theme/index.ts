import DefaultTheme from 'vitepress/theme';
import type { Theme } from 'vitepress';
import './custom.css';

// Extends the default VitePress theme with our brand styling (see custom.css).
// This is exactly the pattern Pinia / Vite / Vue use to brand their docs —
// the layout/components stay the default theme, the look comes from CSS variables.
export default {
  extends: DefaultTheme,
} satisfies Theme;
