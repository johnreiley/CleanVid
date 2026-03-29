// @vitest-environment jsdom

import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import CollapsiblePanelSection from './CollapsiblePanelSection.vue';

describe('CollapsiblePanelSection', () => {
  it('renders the heading, actions, content, and emits toggle events', async () => {
    const wrapper = mount(CollapsiblePanelSection, {
      props: {
        kicker: 'Export',
        title: 'Options',
        expanded: true,
        toggleAreaClass: 'section-heading-actions',
        toggleTestId: 'section-toggle',
        contentTestId: 'section-content'
      },
      slots: {
        actions: '<span class="panel-count">02</span>',
        default: '<p>Section body</p>'
      }
    });

    expect(wrapper.text()).toContain('Export');
    expect(wrapper.text()).toContain('Options');
    expect(wrapper.get('.panel-count').text()).toBe('02');
    expect(wrapper.get('[data-testid="section-content"]').text()).toContain('Section body');

    await wrapper.get('[data-testid="section-toggle"]').trigger('click');

    expect(wrapper.emitted('toggle')).toHaveLength(1);
  });

  it('omits content when collapsed and updates the button label', () => {
    const wrapper = mount(CollapsiblePanelSection, {
      props: {
        kicker: 'Filters',
        title: 'Timeline',
        expanded: false,
        toggleTestId: 'section-toggle',
        contentTestId: 'section-content'
      },
      slots: {
        default: '<p>Hidden body</p>'
      }
    });

    expect(wrapper.find('[data-testid="section-content"]').exists()).toBe(false);
    expect(wrapper.get('[data-testid="section-toggle"]').text()).toContain('Show');
  });
});
