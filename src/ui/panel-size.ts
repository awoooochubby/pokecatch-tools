import { computed, onScopeDispose, ref } from 'vue';
import { useWindowSize } from '@vueuse/core';
import type { Store } from '../core/storage';
export function usePanelSize(store: Store, key: string, defaults: { width: number; height: number }, minimum = { width: 340, height: 340 }) {
  const saved = store.get<Partial<typeof defaults>>(key, {}) || {}, viewport = useWindowSize();
  const requested = ref({ width: Number.isFinite(saved.width) ? saved.width! : defaults.width, height: Number.isFinite(saved.height) ? saved.height! : defaults.height });
  const size = computed(() => ({ width: Math.min(Math.max(minimum.width, requested.value.width), Math.max(280, viewport.width.value - 16)),
    height: Math.min(Math.max(minimum.height, requested.value.height), Math.max(220, viewport.height.value - 16)) }));
  let cleanup = () => {};
  function persist() { store.set(key, requested.value); }
  function resize(event: PointerEvent, left = false) {
    if (event.button !== 0) return;
    event.preventDefault(); event.stopPropagation(); cleanup();
    const target = event.currentTarget as HTMLElement, rect = target.parentElement!.getBoundingClientRect();
    const start = { x: event.clientX, y: event.clientY, width: rect.width, height: rect.height };
    const move = (e: PointerEvent) => { if (e.pointerId !== event.pointerId) return;
      requested.value = { width: Math.min(Math.max(minimum.width, start.width + (e.clientX - start.x) * (left ? -1 : 1)), Math.max(280, viewport.width.value - 16)),
        height: Math.min(Math.max(minimum.height, start.height + e.clientY - start.y), Math.max(220, viewport.height.value - rect.top - 8)) };
    };
    const end = (e: PointerEvent) => { if (e.pointerId === event.pointerId) { cleanup(); persist(); } };
    cleanup = () => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', end); document.removeEventListener('pointercancel', end); };
    document.addEventListener('pointermove', move); document.addEventListener('pointerup', end); document.addEventListener('pointercancel', end);
  }
  function keyboard(e: KeyboardEvent) {
    const delta = { ArrowRight: [32, 0], ArrowLeft: [-32, 0], ArrowDown: [0, 32], ArrowUp: [0, -32] }[e.key];
    if (!delta) return; e.preventDefault();
    requested.value = { width: Math.max(minimum.width, size.value.width + delta[0]), height: Math.max(minimum.height, size.value.height + delta[1]) }; persist();
  }
  onScopeDispose(() => cleanup());
  return { size, resize, keyboard };
}
