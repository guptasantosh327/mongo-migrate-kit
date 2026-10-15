<script setup lang="ts">
import { withBase } from 'vitepress';

// A recorded terminal session (docs/public/casts/<name>.svg, made by scripts/casts/record.mjs).
// It plays on its own and loops, like a GIF.
defineProps<{ name: string; alt: string; caption?: string }>();
</script>

<template>
  <figure class="mmk-figure mmk-cast">
    <img :src="withBase(`/casts/${name}.svg`)" :alt="alt" loading="lazy" />
    <figcaption v-if="caption">{{ caption }}</figcaption>
  </figure>
</template>
