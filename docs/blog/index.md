---
title: Blog
description: Articles on MongoDB migrations — single-file rollbacks, native locking, transactions, CI/CD, running on startup, and hard-won best practices.
aside: false
---

<script setup>
import { computed, ref } from 'vue'
import { data as posts } from './posts.data.ts'

const order = ref('newest')
const sortedPosts = computed(() =>
  [...posts].sort((a, b) =>
    order.value === 'newest' ? b.date.time - a.date.time : a.date.time - b.date.time,
  ),
)
</script>

# Blog

Practical writing on MongoDB migrations — safe rollbacks, locking for concurrent deploys,
running migrations in CI/CD and on app startup, and lessons from real production incidents.

<div class="blog-sort">
  <span class="blog-sort-label">Sort by date:</span>
  <button
    class="blog-sort-btn"
    :class="{ active: order === 'newest' }"
    :aria-pressed="order === 'newest'"
    @click="order = 'newest'"
  >Newest first</button>
  <button
    class="blog-sort-btn"
    :class="{ active: order === 'oldest' }"
    :aria-pressed="order === 'oldest'"
    @click="order = 'oldest'"
  >Oldest first</button>
</div>

<ul class="blog-list">
  <li v-for="post of sortedPosts" :key="post.url" class="blog-item">
    <a :href="post.url" class="blog-title">{{ post.title }}</a>
    <p class="blog-date">{{ post.date.string }} · {{ post.readingTime }} min read</p>
    <p class="blog-desc">{{ post.description }}</p>
  </li>
</ul>

<style scoped>
.blog-sort {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-top: 1.5rem;
}
.blog-sort-label {
  font-size: 0.8rem;
  color: var(--vp-c-text-3);
  margin-right: 0.25rem;
}
.blog-sort-btn {
  font-size: 0.8rem;
  padding: 0.25rem 0.75rem;
  border: 1px solid var(--vp-c-divider);
  border-radius: 999px;
  color: var(--vp-c-text-2);
  background: transparent;
  cursor: pointer;
  transition: color 0.2s, border-color 0.2s, background-color 0.2s;
}
.blog-sort-btn:hover {
  color: var(--vp-c-brand-1);
  border-color: var(--vp-c-brand-1);
}
.blog-sort-btn.active {
  color: var(--vp-c-brand-1);
  border-color: var(--vp-c-brand-1);
  background: var(--vp-c-brand-soft);
  font-weight: 600;
}
.blog-list {
  list-style: none;
  padding: 0;
  margin: 2rem 0 0;
}
.blog-item {
  padding: 1.25rem 0;
  border-top: 1px solid var(--vp-c-divider);
}
.blog-item:last-child {
  border-bottom: 1px solid var(--vp-c-divider);
}
.blog-title {
  font-size: 1.2rem;
  font-weight: 600;
  line-height: 1.4;
  color: var(--vp-c-text-1);
  text-decoration: none;
}
.blog-title:hover {
  color: var(--vp-c-brand-1);
}
.blog-date {
  margin: 0.35rem 0 0;
  font-size: 0.8rem;
  color: var(--vp-c-text-3);
}
.blog-desc {
  margin: 0.5rem 0 0;
  color: var(--vp-c-text-2);
  line-height: 1.6;
}
</style>
