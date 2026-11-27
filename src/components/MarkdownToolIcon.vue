<script setup lang="ts">
import type { MarkdownFormatAction } from "../editor/markdown-formatting";

defineProps<{ action: MarkdownFormatAction }>();
</script>

<template>
  <svg
    v-if="action === 'link'"
    viewBox="0 0 24 24"
    class="size-[18px]"
    fill="none"
    stroke="currentColor"
    stroke-width="1.6"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    data-markdown-icon="link"
  >
    <path d="m9 14 6-6" />
    <path d="m8 11-2 2a3.5 3.5 0 0 0 5 5l3-3" />
    <path d="m14 11 2-2a3.5 3.5 0 0 0-5-5L8 7" />
  </svg>
  <svg
    v-else-if="action === 'orderedList'"
    viewBox="0 0 24 24"
    class="size-[18px]"
    fill="none"
    stroke="currentColor"
    stroke-width="1.6"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    data-markdown-icon="ordered-list"
  >
    <path d="M9 5h11M9 12h11M9 19h11" />
    <path d="m3 4 1-1v4M3 7h2M3 11c0-2 3-2 3 0 0 1-3 2-3 3h3M3 17h2l-1 2c3-1 3 3-1 2" />
  </svg>
  <svg
    v-else-if="action === 'unorderedList'"
    viewBox="0 0 24 24"
    class="size-[18px]"
    fill="none"
    stroke="currentColor"
    stroke-width="1.6"
    stroke-linecap="round"
    aria-hidden="true"
    data-markdown-icon="unordered-list"
  >
    <path d="M9 5h11M9 12h11M9 19h11" />
    <circle cx="4" cy="5" r="1.35" fill="currentColor" stroke="none" />
    <circle cx="4" cy="12" r="1.35" fill="currentColor" stroke="none" />
    <circle cx="4" cy="19" r="1.35" fill="currentColor" stroke="none" />
  </svg>
  <svg
    v-else-if="action === 'image'"
    viewBox="0 0 24 24"
    class="size-[18px]"
    fill="none"
    stroke="currentColor"
    stroke-width="1.6"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    data-markdown-icon="image"
  >
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <circle cx="8" cy="8" r="1.5" />
    <path d="m3 17 6-6 4 4 3-3 5 5" />
  </svg>
</template>
