<script setup lang="ts" generic="T extends string">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId } from "vue";

export interface PopupOption<Value extends string> { value: Value; label: string }

const props = defineProps<{
  modelValue: T;
  options: readonly PopupOption<T>[];
  label: string;
  disabled?: boolean;
}>();
const emit = defineEmits<{ "update:modelValue": [value: T] }>();
const root = ref<HTMLElement>();
const trigger = ref<HTMLButtonElement>();
const listboxId = `status-select-${useId().replace(/:/g, "")}`;
const optionButtons = ref<HTMLButtonElement[]>([]);
const open = ref(false);
const activeIndex = ref(0);
const selectedIndex = computed(() => Math.max(0, props.options.findIndex((option) => option.value === props.modelValue)));
const selectedLabel = computed(() => props.options[selectedIndex.value]?.label ?? props.modelValue);

function close(focus = false): void {
  open.value = false;
  if (focus) void nextTick(() => trigger.value?.focus());
}
function show(preferred = selectedIndex.value): void {
  if (props.disabled) return;
  open.value = true;
  activeIndex.value = Math.max(0, Math.min(preferred, props.options.length - 1));
  void nextTick(() => optionButtons.value[activeIndex.value]?.focus());
}
function toggle(): void { open.value ? close() : show(); }
function choose(value: T): void { emit("update:modelValue", value); close(true); }
function move(delta: number): void {
  const count = props.options.length;
  if (!count) return;
  activeIndex.value = (activeIndex.value + delta + count) % count;
  void nextTick(() => optionButtons.value[activeIndex.value]?.focus());
}
function triggerKeydown(event: KeyboardEvent): void {
  if (["ArrowUp", "ArrowDown", "Enter", " "].includes(event.key)) {
    event.preventDefault();
    show(event.key === "ArrowUp" ? props.options.length - 1 : selectedIndex.value);
  }
}
function optionKeydown(event: KeyboardEvent, option: PopupOption<T>): void {
  if (event.key === "ArrowUp" || event.key === "ArrowDown") {
    event.preventDefault(); move(event.key === "ArrowDown" ? 1 : -1);
  } else if (event.key === "Home" || event.key === "End") {
    event.preventDefault(); activeIndex.value = event.key === "Home" ? 0 : props.options.length - 1; void nextTick(() => optionButtons.value[activeIndex.value]?.focus());
  } else if (event.key === "Enter" || event.key === " ") {
    event.preventDefault(); choose(option.value);
  } else if (event.key === "Escape" || event.key === "Tab") {
    if (event.key === "Escape") event.preventDefault();
    close(event.key === "Escape");
  }
}
function outside(event: PointerEvent): void { if (open.value && !root.value?.contains(event.target as Node)) close(); }
function escape(event: KeyboardEvent): void { if (open.value && event.key === "Escape") { event.preventDefault(); close(true); } }

onMounted(() => { document.addEventListener("pointerdown", outside); document.addEventListener("keydown", escape); });
onBeforeUnmount(() => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); });
</script>

<template>
  <div ref="root" class="relative shrink-0">
    <button
      ref="trigger"
      type="button"
      role="combobox"
      :aria-label="label"
      :aria-expanded="open"
      :aria-controls="listboxId"
      :data-value="modelValue"
      aria-haspopup="listbox"
      :disabled="disabled"
      class="group flex h-6 items-center gap-1 rounded-field px-1.5 text-[10px] text-base-content/60 transition-colors hover:bg-base-200 hover:text-base-content focus-visible:outline-2 focus-visible:outline-primary"
      @click="toggle"
      @keydown="triggerKeydown"
    >
      <span class="max-w-28 truncate">{{ selectedLabel }}</span>
      <svg viewBox="0 0 12 12" class="size-2.5 text-base-content/35 transition-transform duration-150" :class="{ 'rotate-180': open }" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="m2.5 7.5 3.5-3 3.5 3" /></svg>
    </button>
    <Transition name="status-menu">
      <ul
        v-if="open"
        :id="listboxId"
        role="listbox"
        :aria-label="label"
        class="menu menu-xs absolute bottom-[calc(100%+0.45rem)] right-0 z-30 max-h-80 min-w-40 flex-nowrap overflow-y-auto rounded-box border border-base-300 bg-base-100 p-1.5 text-xs shadow-xl shadow-base-content/10"
      >
        <li v-for="(option, index) in options" :key="option.value">
          <button
            :ref="(element) => { if (element) optionButtons[index] = element as HTMLButtonElement }"
            type="button"
            role="option"
            :aria-selected="option.value === modelValue"
            class="flex h-8 items-center justify-between gap-3 rounded-field px-2.5"
            :class="{ 'menu-active': option.value === modelValue }"
            @click="choose(option.value)"
            @keydown="optionKeydown($event, option)"
          >
            <span>{{ option.label }}</span>
            <svg v-if="option.value === modelValue" viewBox="0 0 16 16" class="size-3.5 text-primary" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="m3 8.5 3 3 7-7" /></svg>
          </button>
        </li>
      </ul>
    </Transition>
  </div>
</template>
