<script setup lang="ts">
import PhX from '@phosphor-icons-vue-icons/PhX.vue.mjs';

defineEmits<{
  dismiss: [];
}>();

defineProps<{
  activeToast: { kind: 'error' | 'status'; message: string; key: string } | null;
}>();
</script>

<template>
  <div class="toast-stack" aria-live="polite" aria-atomic="true">
    <Transition name="toast" appear>
      <div
        v-if="activeToast"
        :key="activeToast.key"
        :class="[
          'feedback-card',
          'feedback-toast',
          activeToast.kind === 'error' ? 'feedback-card-error' : 'feedback-card-quiet'
        ]"
        :data-testid="activeToast.kind === 'error' ? 'error-message' : 'status-message'"
      >
        <span class="feedback-toast-copy">{{ activeToast.message }}</span>
        <button
          type="button"
          class="toast-dismiss-button"
          data-testid="toast-dismiss"
          aria-label="Dismiss notification"
          title="Dismiss notification"
          @click="$emit('dismiss')"
        >
          <PhX :size="14" />
        </button>
      </div>
    </Transition>
  </div>
</template>
