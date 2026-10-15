<script setup lang="ts">
import { computed } from 'vue';

// The diagrams are plain SVG files in docs/public/diagrams, so GitHub and npm can show them as
// images too. On this site they are inlined instead, which lets them pick up the theme colours
// (see the `html .dg` rule inside each file) and follow the light/dark switch.
const files = import.meta.glob('../../public/diagrams/*.svg', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const props = defineProps<{ name: string; caption?: string }>();

const svg = computed(() => {
  const entry = Object.entries(files).find(([path]) => path.endsWith(`/${props.name}.svg`));
  return entry ? entry[1] : '';
});
</script>

<template>
  <figure class="mmk-figure">
    <div class="mmk-diagram" v-html="svg" />
    <figcaption v-if="caption">{{ caption }}</figcaption>
  </figure>
</template>
