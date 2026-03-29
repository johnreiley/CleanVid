// @vitest-environment jsdom

import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import SidebarModeTabs from './SidebarModeTabs.vue';

describe('SidebarModeTabs', () => {
  it('renders all workspace modes and emits changes', async () => {
    const wrapper = mount(SidebarModeTabs, {
      props: {
        currentMode: 'annotate'
      }
    });

    expect(wrapper.get('[data-testid="mode-media-button"]').text()).toContain('Media');
    expect(wrapper.get('[data-testid="mode-annotate-button"]').classes()).toContain(
      'sidebar-mode-button-active'
    );
    expect(wrapper.get('[data-testid="mode-export-button"]').text()).toContain('Export');

    await wrapper.get('[data-testid="mode-export-button"]').trigger('click');

    expect(wrapper.emitted('changeMode')).toEqual([['export']]);
  });
});
