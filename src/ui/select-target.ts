import { inject, type InjectionKey } from 'vue';
export const selectTargetKey: InjectionKey<HTMLElement> = Symbol('pc-select-layer');
// Keep popups in our ShadowRoot, outside resizable/scrolling panels. Their fixed
// positioning must not inherit a container-query containing block.
export const useSelectTarget = () => inject(selectTargetKey, undefined) || false;
