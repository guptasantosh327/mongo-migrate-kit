import { createContentLoader } from 'vitepress';

export interface BlogPost {
  title: string;
  url: string;
  description: string;
  readingTime: number;
  date: { time: number; string: string };
}

declare const data: BlogPost[];
export { data };

export default createContentLoader('blog/*.md', {
  includeSrc: true,
  transform(raw): BlogPost[] {
    return raw
      .filter((page) => page.url !== '/blog/' && Boolean(page.frontmatter.date))
      .map((page) => ({
        title: page.frontmatter.title as string,
        url: page.url,
        description: (page.frontmatter.description as string) ?? '',
        readingTime: readingMinutes(page.src),
        date: formatDate(page.frontmatter.date as string),
      }))
      .sort((a, b) => b.date.time - a.date.time);
  },
});

function readingMinutes(src: string | undefined): number {
  if (!src) return 1;
  const words = src
    .replace(/^---[\s\S]*?---/, '')
    .split(/\s+/)
    .filter(Boolean).length;
  return Math.max(1, Math.round(words / 200));
}

function formatDate(raw: string): BlogPost['date'] {
  const date = new Date(raw);
  date.setUTCHours(12);
  return {
    time: +date,
    string: date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    }),
  };
}
