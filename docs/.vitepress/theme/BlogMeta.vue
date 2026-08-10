<script setup lang="ts">
import { computed } from 'vue';
import { useData } from 'vitepress';

const { frontmatter } = useData();

const dateString = computed(() => {
  const raw = frontmatter.value.date;
  if (!raw) return '';
  const d = new Date(raw as string);
  d.setUTCHours(12);
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
});
</script>

<template>
  <div v-if="frontmatter.date" class="blog-meta">
    <span v-if="frontmatter.author" class="blog-meta-author">{{ frontmatter.author }}</span>
    <span v-if="frontmatter.author" class="blog-meta-sep">·</span>
    <time :datetime="String(frontmatter.date)">{{ dateString }}</time>
    <template v-if="frontmatter.readingTime">
      <span class="blog-meta-sep">·</span>
      <span>{{ frontmatter.readingTime }} min read</span>
    </template>
  </div>
</template>

<style scoped>
.blog-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.4rem;
  margin: 0 0 0.5rem;
  font-size: 0.85rem;
  color: var(--vp-c-text-2);
}
.blog-meta-author {
  font-weight: 600;
  color: var(--vp-c-text-1);
}
.blog-meta-sep {
  color: var(--vp-c-text-3);
}
</style>
