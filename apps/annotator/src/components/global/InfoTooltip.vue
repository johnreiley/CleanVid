<script setup lang="ts">
import PhInfo from '@phosphor-icons-vue-icons/PhInfo.vue.mjs';

const props = withDefaults(
  defineProps<{
    ariaLabel?: string;
  }>(),
  {
    ariaLabel: 'More information'
  }
);

const tooltipId = `info-tooltip-${Math.random().toString(36).slice(2, 10)}`;
</script>

<template>
  <span class="field-tooltip">
    <button
      type="button"
      class="field-tooltip-button"
      :aria-label="props.ariaLabel"
      :aria-describedby="tooltipId"
    >
      <slot name="icon">
        <PhInfo :size="18" weight="fill" />
      </slot>
    </button>

    <span :id="tooltipId" class="field-tooltip-content" role="tooltip">
      <slot />
    </span>
  </span>
</template>
