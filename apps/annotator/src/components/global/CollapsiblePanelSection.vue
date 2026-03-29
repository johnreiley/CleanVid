<script setup lang="ts">
const emit = defineEmits<{
  toggle: [];
}>();

withDefaults(
  defineProps<{
    contentClass?: string;
    contentTestId?: string;
    expanded: boolean;
    headingClass?: string;
    kicker: string;
    title: string;
    toggleAreaClass?: string;
    toggleTestId?: string;
  }>(),
  {
    contentClass: '',
    contentTestId: undefined,
    headingClass: '',
    toggleAreaClass: '',
    toggleTestId: undefined
  }
);
</script>

<template>
  <div :class="['panel-heading', headingClass]">
    <div>
      <p class="section-kicker">{{ kicker }}</p>
      <h2>{{ title }}</h2>
    </div>

    <div :class="toggleAreaClass">
      <slot name="actions" />
      <button
        type="button"
        class="section-toggle-button"
        :data-testid="toggleTestId"
        :aria-expanded="expanded"
        @click="emit('toggle')"
      >
        {{ expanded ? 'Hide' : 'Show' }}
      </button>
    </div>
  </div>

  <div
    v-if="expanded"
    :class="['collapsible-section-content', contentClass]"
    :data-testid="contentTestId"
  >
    <slot />
  </div>
</template>
