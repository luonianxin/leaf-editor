<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, useId, watch } from "vue";
import { confirmedPickerPaths, pathBreadcrumbs, togglePickerSelection, type PathPickerMode } from "../core/pathPicker";
import type { DirectoryEntry, DirectoryListing } from "../core/types";
import { directoryPort, getStartDirectory } from "../platform/files";

const props = withDefaults(defineProps<{
  open: boolean;
  mode: PathPickerMode;
  initialPath?: string;
  title?: string;
}>(), { initialPath: "", title: "" });
const emit = defineEmits<{
  "update:open": [value: boolean];
  cancel: [];
  select: [paths: string[]];
}>();

const dialog = ref<HTMLDialogElement>();
const listbox = ref<HTMLElement>();
const listing = ref<DirectoryListing>();
const selectedPaths = ref<string[]>([]);
const pathInput = ref("");
const loading = ref(false);
const errorMessage = ref("");
const activeIndex = ref(-1);
const id = `path-picker-${useId()}`;
let generation = 0;
let finished = false;
const entries = computed(() => listing.value?.entries ?? []);
const breadcrumbs = computed(() => pathBreadcrumbs(listing.value?.root ?? ""));
const dialogTitle = computed(() => props.title || (props.mode === "files" ? "打开文件" : "选择文件夹"));
const canConfirm = computed(() => !loading.value && !!listing.value && (props.mode === "directory" || selectedPaths.value.length > 0));
const selectionSummary = computed(() => props.mode === "files"
  ? `已选择 ${selectedPaths.value.length} 个文件`
  : selectedPaths.value[0] ? `将选择：${selectedPaths.value[0]}` : "将选择当前文件夹");

function isDisabled(entry: DirectoryEntry): boolean {
  return entry.kind === "symlink" || (props.mode === "directory" && entry.kind === "file");
}

// A request owns its result only until the next navigation, close, or unmount.
async function browse(path?: string): Promise<void> {
  const restoreListFocus = document.activeElement === listbox.value;
  const request = ++generation;
  loading.value = true;
  errorMessage.value = "";
  listing.value = undefined;
  selectedPaths.value = [];
  activeIndex.value = -1;
  try {
    const target = path ?? await getStartDirectory();
    if (request !== generation) return;
    pathInput.value = target;
    if (!target.trim()) throw new Error("请输入文件夹路径。");
    const result = await directoryPort.list(target);
    if (request !== generation) return;
    listing.value = result;
    pathInput.value = result.root;
    activeIndex.value = result.entries.findIndex((entry) => !isDisabled(entry));
  } catch (error) {
    if (request === generation) errorMessage.value = `无法打开文件夹：${error instanceof Error ? error.message : String(error)}`;
  } finally {
    if (request === generation) {
      loading.value = false;
      if (restoreListFocus) {
        await nextTick();
        if (request === generation) (listbox.value ?? document.getElementById(`${id}-path`))?.focus();
      }
    }
  }
}

function chooseEntry(entry: DirectoryEntry): void {
  if (loading.value || isDisabled(entry)) return;
  if ((props.mode === "files" && entry.kind === "file") || (props.mode === "directory" && entry.kind === "directory")) {
    selectedPaths.value = togglePickerSelection(selectedPaths.value, entry.path, props.mode);
  }
}

function clickEntry(entry: DirectoryEntry, index: number, event: MouseEvent): void {
  if (isDisabled(entry)) return;
  activeIndex.value = index;
  listbox.value?.focus();
  // Do not toggle a file off on the second click of a double-click.
  if (event.detail <= 1) chooseEntry(entry);
}

function scrollActive(): void {
  document.getElementById(`${id}-option-${activeIndex.value}`)?.scrollIntoView({ block: "nearest" });
}

async function handleListKeydown(event: KeyboardEvent): Promise<void> {
  if (event.altKey && event.key === "ArrowUp") {
    event.preventDefault();
    if (listing.value?.parent) await browse(listing.value.parent);
    return;
  }
  const enabled = entries.value.map((_, index) => index).filter((index) => !isDisabled(entries.value[index]));
  if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
    event.preventDefault();
    const position = enabled.indexOf(activeIndex.value);
    if (event.key === "Home") activeIndex.value = enabled[0] ?? -1;
    else if (event.key === "End") activeIndex.value = enabled.at(-1) ?? -1;
    else activeIndex.value = enabled[(position + (event.key === "ArrowDown" ? 1 : -1) + enabled.length) % enabled.length] ?? -1;
    scrollActive();
    return;
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a" && props.mode === "files") {
    event.preventDefault();
    selectedPaths.value = entries.value.filter((entry) => entry.kind === "file").map((entry) => entry.path);
    return;
  }
  const entry = entries.value[activeIndex.value];
  if (!entry || isDisabled(entry)) return;
  if (event.key === "Enter" && !event.ctrlKey && !event.metaKey) {
    event.preventDefault();
    if (entry.kind === "directory") await browse(entry.path);
    else chooseEntry(entry);
  } else if (event.key === " ") {
    event.preventDefault();
    chooseEntry(entry);
  }
}

function finish(cancelled: boolean): void {
  if (finished) return;
  finished = true;
  generation += 1;
  loading.value = false;
  dialog.value?.close();
  if (cancelled) emit("cancel");
  emit("update:open", false);
}

function confirmSelection(): void {
  if (finished || !canConfirm.value || !listing.value) return;
  const paths = confirmedPickerPaths(props.mode, listing.value.root, selectedPaths.value);
  finish(false);
  emit("select", paths);
}

function handleDialogKeydown(event: KeyboardEvent): void {
  if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    confirmSelection();
  }
  // Keep application-level editor shortcuts from acting behind the modal.
  event.stopPropagation();
}

watch(() => [props.open, props.mode] as const, async ([open]) => {
  const request = ++generation;
  await nextTick();
  if (request !== generation) return;
  if (open && props.open) {
    finished = false;
    if (!dialog.value?.open) dialog.value?.showModal();
    pathInput.value = props.initialPath;
    await browse(props.initialPath || undefined);
    await nextTick();
    if (props.open && !finished && !loading.value) {
      (listbox.value ?? document.getElementById(`${id}-path`))?.focus();
    }
  } else {
    finished = true;
    dialog.value?.close();
  }
}, { immediate: true });

onBeforeUnmount(() => {
  generation += 1;
  dialog.value?.close();
});
</script>

<template>
  <dialog :id="id" ref="dialog" class="modal modal-middle" :aria-labelledby="`${id}-title`" :aria-describedby="`${id}-help`" @cancel.prevent="finish(true)" @keydown="handleDialogKeydown">
    <div class="modal-box flex h-[min(80vh,44rem)] w-11/12 max-w-3xl flex-col gap-3 overflow-hidden p-4 sm:p-5">
      <h2 :id="`${id}-title`" class="text-lg font-semibold">{{ dialogTitle }}</h2>
      <div class="flex flex-wrap items-center gap-2 sm:flex-nowrap">
        <button type="button" class="btn btn-sm" :disabled="loading" @click="browse()">主目录</button>
        <button type="button" class="btn btn-sm" :disabled="loading || !listing?.parent" title="上一级文件夹（列表内 Alt+↑）" @click="listing?.parent && browse(listing.parent)">上一级</button>
        <form class="flex min-w-0 flex-1 gap-2" @submit.prevent="browse(pathInput)">
          <label class="sr-only" :for="`${id}-path`">文件夹路径</label>
          <input :id="`${id}-path`" v-model="pathInput" autofocus class="input input-sm min-w-0 flex-1 font-mono text-xs" type="text" autocomplete="off" spellcheck="false" :disabled="loading" />
          <button type="submit" class="btn btn-sm" :disabled="loading || !pathInput.trim()">转到</button>
        </form>
      </div>
      <!-- Breadcrumb/list styles use utilities because the app enables only a subset of daisyUI. -->
      <nav v-if="breadcrumbs.length" class="shrink-0 overflow-x-auto rounded-field bg-base-200 px-2" aria-label="当前路径">
        <ol class="flex min-w-max items-center text-xs">
          <li v-for="(crumb, index) in breadcrumbs" :key="crumb.path" class="flex items-center">
            <span v-if="index" class="px-1 text-base-content/40" aria-hidden="true">/</span>
            <button type="button" class="rounded-field px-1.5 py-1 hover:bg-base-300" :aria-current="index === breadcrumbs.length - 1 ? 'location' : undefined" :disabled="loading" @click="browse(crumb.path)">{{ crumb.label }}</button>
          </li>
        </ol>
      </nav>
      <div v-if="errorMessage" role="alert" class="alert alert-error py-2 text-sm">
        <span class="break-words">{{ errorMessage }}</span>
        <button type="button" class="btn btn-sm" :disabled="loading" @click="browse(pathInput || undefined)">重试</button>
      </div>
      <div class="min-h-0 flex-1 overflow-hidden rounded-box border border-base-300" :aria-busy="loading">
        <div v-if="loading" class="flex h-full items-center justify-center gap-2 text-sm text-base-content/60" role="status">
          <span class="loading loading-spinner loading-sm" aria-hidden="true" />正在读取文件夹…
        </div>
        <div v-else-if="listing && !entries.length" class="flex h-full items-center justify-center text-sm text-base-content/60" role="status">此文件夹为空</div>
        <div v-else-if="listing" ref="listbox" class="h-full overflow-y-auto p-1 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary" role="listbox" tabindex="0" aria-label="文件和文件夹" :aria-multiselectable="mode === 'files' ? true : undefined" :aria-activedescendant="activeIndex >= 0 ? `${id}-option-${activeIndex}` : undefined" @keydown="handleListKeydown">
          <div v-for="(entry, index) in entries" :id="`${id}-option-${index}`" :key="entry.path" role="option" class="flex min-h-9 items-center gap-2 rounded-field px-2 py-1.5 text-sm select-none" :class="[selectedPaths.includes(entry.path) ? 'bg-primary/15' : activeIndex === index ? 'bg-base-200' : 'hover:bg-base-200/70', isDisabled(entry) ? 'cursor-not-allowed opacity-45' : 'cursor-default']" :aria-selected="selectedPaths.includes(entry.path)" :aria-disabled="isDisabled(entry) || undefined" :title="entry.path" @click="clickEntry(entry, index, $event)" @dblclick="entry.kind === 'directory' && browse(entry.path)">
            <span class="w-14 shrink-0 text-xs text-base-content/60">{{ entry.kind === 'directory' ? '文件夹' : entry.kind === 'file' ? '文件' : '链接' }}</span>
            <span class="min-w-0 flex-1 truncate">{{ entry.name }}</span>
            <span v-if="entry.kind === 'symlink'" class="shrink-0 text-xs">不可用</span>
            <span v-else-if="selectedPaths.includes(entry.path)" class="shrink-0 text-xs">已选择</span>
          </div>
        </div>
      </div>
      <p class="truncate text-xs text-base-content/65" role="status">{{ listing ? selectionSummary : '' }}</p>
      <p :id="`${id}-help`" class="text-xs text-base-content/60">双击或 Enter 进入文件夹；单击或空格选择；方向键移动；Ctrl+Enter 打开；Esc 取消。</p>
      <form method="dialog" class="modal-action mt-0" @submit.prevent="finish(true)">
        <button type="submit" class="btn btn-ghost">取消</button>
        <button type="button" class="btn btn-primary" :disabled="!canConfirm" @click="confirmSelection">{{ mode === 'directory' ? '选择文件夹' : '打开' }}</button>
      </form>
    </div>
  </dialog>
</template>
