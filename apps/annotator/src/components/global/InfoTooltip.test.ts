// @vitest-environment jsdom

import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import InfoTooltip from './InfoTooltip.vue';

describe('InfoTooltip', () => {
  it('renders tooltip content and links it to the trigger button', () => {
    const wrapper = mount(InfoTooltip, {
      props: {
        ariaLabel: 'Explain output path'
      },
      slots: {
        default: 'Defaults to the same directory as the opened video'
      }
    });

    const button = wrapper.get('button');
    const tooltip = wrapper.get('[role="tooltip"]');

    expect(button.attributes('aria-label')).toBe('Explain output path');
    expect(tooltip.text()).toContain('Defaults to the same directory as the opened video');
    expect(button.attributes('aria-describedby')).toBe(tooltip.attributes('id'));
  });
});
