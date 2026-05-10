<script setup lang="ts">
import type { FiltersObjectCategory } from '@cleanvid/shared';
import { computed } from 'vue';

const emit = defineEmits<{
  toggleCategory: [payload: { ids: string[]; selected: boolean }];
  toggleTag: [payload: { id: string; selected: boolean }];
}>();

const props = defineProps<{
  category: FiltersObjectCategory;
  selectedTagIds: string[];
}>();

function collectTagIds(category: FiltersObjectCategory): string[] {
  return [
    ...category.tags.map((tag) => tag.id),
    ...category.childCategories.flatMap((child) => collectTagIds(child))
  ];
}

const descendantTagIds = computed(() => collectTagIds(props.category));
const selectedTagIdSet = computed(() => new Set(props.selectedTagIds));
const selectedCount = computed(
  () => descendantTagIds.value.filter((id) => selectedTagIdSet.value.has(id)).length
);
const isChecked = computed(
  () => descendantTagIds.value.length > 0 && selectedCount.value === descendantTagIds.value.length
);
const isIndeterminate = computed(
  () => selectedCount.value > 0 && selectedCount.value < descendantTagIds.value.length
);

function handleCategoryToggle(event: Event) {
  const input = event.target as HTMLInputElement;

  emit('toggleCategory', {
    ids: descendantTagIds.value,
    selected: input.checked
  });
}

function handleTagToggle(id: string, event: Event) {
  const input = event.target as HTMLInputElement;

  emit('toggleTag', {
    id,
    selected: input.checked
  });
}
</script>

<template>
  <details class="filters-object-category" data-testid="filters-object-category" open>
    <summary class="filters-object-category-summary">
      <label class="filters-object-check-row filters-object-category-check" @click.stop>
        <input
          type="checkbox"
          data-testid="filters-object-category-checkbox"
          :checked="isChecked"
          :disabled="descendantTagIds.length === 0"
          :indeterminate="isIndeterminate"
          @change="handleCategoryToggle"
        />
        <span class="filters-object-category-title">{{ category.title }}</span>
        <span class="filters-object-count-chip">
          {{ selectedCount }}/{{ descendantTagIds.length }}
        </span>
      </label>
    </summary>

    <div class="filters-object-category-body">
      <ul v-if="category.tags.length > 0" class="filters-object-tag-list">
        <li v-for="tag in category.tags" :key="tag.id" class="filters-object-tag-row">
          <label class="filters-object-check-row">
            <input
              type="checkbox"
              data-testid="filters-object-tag-checkbox"
              :checked="selectedTagIdSet.has(tag.id)"
              @change="handleTagToggle(tag.id, $event)"
            />
            <span class="filters-object-tag-copy">
              <span class="filters-object-tag-description">{{ tag.description }}</span>
              <span class="filters-object-tag-meta">
                {{ tag.sourceType === 'audio' ? 'Audio' : 'Audiovisual' }}
                {{ tag.start.toFixed(2) }}s-{{ tag.end.toFixed(2) }}s
              </span>
            </span>
          </label>
        </li>
      </ul>

      <FiltersObjectCategoryNode
        v-for="child in category.childCategories"
        :key="child.id"
        :category="child"
        :selected-tag-ids="selectedTagIds"
        @toggle-category="emit('toggleCategory', $event)"
        @toggle-tag="emit('toggleTag', $event)"
      />
    </div>
  </details>
</template>
