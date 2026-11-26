<script setup lang="ts">
import type { DirectoryNode } from "../core/directoryTree";
import { pathKey } from "../core/workspace";

defineOptions({ name: "DirectoryTreeNode" });
const props = withDefaults(defineProps<{ node: DirectoryNode; depth?: number; activePath?: string }>(), { depth: 0, activePath: undefined });
const emit = defineEmits<{ toggle: [node: DirectoryNode]; open: [node: DirectoryNode] }>();

function activate(): void {
  if (props.node.kind === "directory") emit("toggle", props.node);
  else if (props.node.kind === "file") emit("open", props.node);
}
</script>

<template>
  <li role="none" class="block">
    <button
      type="button"
      role="treeitem"
      class="flex h-8 w-full items-center gap-1.5 rounded-md pr-2 text-left text-xs"
      :class="{ 'menu-active': node.kind === 'file' && !!activePath && pathKey(node.path) === pathKey(activePath), 'text-base-content/40': node.kind === 'symlink' }"
      :style="{ paddingLeft: `${8 + depth * 14}px` }"
      :aria-expanded="node.kind === 'directory' ? !!node.expanded : undefined"
      :aria-label="`${node.kind === 'directory' ? (node.expanded ? '收起文件夹' : '展开文件夹') : node.kind === 'file' ? '打开文件' : '符号链接'} ${node.name}`"
      :title="node.kind === 'symlink' ? `${node.name} · 首版不展开符号链接` : node.path"
      :disabled="node.kind === 'symlink'"
      @click="activate"
    >
      <span class="flex size-3.5 shrink-0 items-center justify-center text-[10px] text-base-content/40" aria-hidden="true">
        <span v-if="node.loading" class="loading loading-spinner loading-xs" />
        <span v-else-if="node.kind === 'directory'" class="transition-transform" :class="{ 'rotate-90': node.expanded }">›</span>
      </span>
      <svg v-if="node.kind === 'directory'" viewBox="0 0 20 18" class="size-4 shrink-0 text-base-content/50" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true"><path d="M2 4.5h6l1.8 2H18v9H2z" /><path d="M2 6.5V3h5.5l1.8 2H18v1.5" /></svg>
      <svg v-else-if="node.kind === 'file'" viewBox="0 0 16 18" class="h-3.5 w-3 shrink-0 text-base-content/40" fill="none" stroke="currentColor" stroke-width="1.2" aria-hidden="true"><path d="M3 1.5h6l4 4v11H3zM9 1.5v4h4" /></svg>
      <span v-else class="shrink-0 text-base-content/35" aria-hidden="true">↗</span>
      <span class="min-w-0 flex-1 truncate">{{ node.name }}</span>
    </button>
    <ul v-if="node.kind === 'directory' && node.expanded" role="group" class="m-0 list-none p-0">
      <DirectoryTreeNode v-for="child in node.children" :key="`${child.kind}:${child.path}`" :node="child" :depth="depth + 1" :active-path="activePath" @toggle="emit('toggle', $event)" @open="emit('open', $event)" />
      <li v-if="node.children?.length === 0" role="none" class="py-1 pr-2 text-[10px] text-base-content/35" :style="{ paddingLeft: `${30 + depth * 14}px` }">空文件夹</li>
    </ul>
  </li>
</template>
