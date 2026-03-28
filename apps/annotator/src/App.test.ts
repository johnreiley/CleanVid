// @vitest-environment jsdom

import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App.vue';

const originalCreateObjectURL = URL.createObjectURL;
const originalRevokeObjectURL = URL.revokeObjectURL;
let lastExportBlob: Blob | null = null;
const playMock = vi.fn(async function play(this: HTMLVideoElement) {
  Object.defineProperty(this, 'paused', {
    configurable: true,
    get: () => false
  });
});
const pauseMock = vi.fn(function pause(this: HTMLVideoElement) {
  Object.defineProperty(this, 'paused', {
    configurable: true,
    get: () => true
  });
});

function assignFiles(input: HTMLInputElement, files: File[]) {
  Object.defineProperty(input, 'files', {
    configurable: true,
    value: files
  });
}

function flushPromises() {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

function createPointerEvent(type: string, clientX: number, pointerId = 1) {
  const event = new Event(type, { bubbles: true, cancelable: true });

  Object.defineProperties(event, {
    clientX: { value: clientX },
    pointerId: { value: pointerId }
  });

  return event;
}

async function editContentEditable(
  wrapper: ReturnType<typeof mount>,
  selector: string,
  value: string,
  index = 0
) {
  const editable = wrapper.findAll(selector)[index];
  const element = editable.element as HTMLElement;

  element.textContent = value;
  element.dispatchEvent(new Event('focus'));
  element.dispatchEvent(new Event('blur'));
  await nextTick();
}

function getEditableText(wrapper: ReturnType<typeof mount>, selector: string, index = 0) {
  return (wrapper.findAll(selector)[index]?.element as HTMLElement | undefined)?.textContent ?? '';
}

async function readBlobText(blob: Blob): Promise<string> {
  if (typeof blob.text === 'function') {
    return blob.text();
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onerror = () => reject(new Error('Unable to read blob contents.'));
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.readAsText(blob);
  });
}

function setVideoMetrics(video: HTMLVideoElement, duration: number, current = 0) {
  Object.defineProperty(video, 'duration', {
    configurable: true,
    value: duration
  });
  video.currentTime = current;
  Object.defineProperty(video, 'paused', {
    configurable: true,
    get: () => true
  });
}

async function loadVideo(wrapper: ReturnType<typeof mount>) {
  const input = wrapper.get('[data-testid="video-input"]').element as HTMLInputElement;
  assignFiles(input, [new File(['video'], 'movie.mp4', { type: 'video/mp4' })]);
  input.dispatchEvent(new Event('change'));
  await nextTick();

  const video = wrapper.get('[data-testid="video-player"]').element as HTMLVideoElement;
  setVideoMetrics(video, 120, 0);
  video.dispatchEvent(new Event('loadedmetadata'));
  await nextTick();
  return video;
}

beforeEach(() => {
  let blobCounter = 0;
  lastExportBlob = null;
  playMock.mockClear();
  pauseMock.mockClear();

  URL.createObjectURL = vi.fn((value: Blob | MediaSource) => {
    blobCounter += 1;
    if (value instanceof Blob && !(value instanceof File)) {
      lastExportBlob = value;
    }
    return value instanceof Blob && !(value instanceof File)
      ? `blob:download-${blobCounter}`
      : `blob:video-${blobCounter}`;
  });
  URL.revokeObjectURL = vi.fn();
  HTMLMediaElement.prototype.play = playMock;
  HTMLMediaElement.prototype.pause = pauseMock;
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
});

describe('annotator app', () => {
  it('renders the streamlined cinematic layout', () => {
    const wrapper = mount(App);

    expect(wrapper.get('[data-testid="workspace"]')).toBeTruthy();
    expect(wrapper.get('[data-testid="markers-panel"]')).toBeTruthy();
    expect(wrapper.get('[data-testid="stage-shell"]')).toBeTruthy();
    expect(wrapper.get('[data-testid="top-bar"]')).toBeTruthy();
    expect(wrapper.get('[data-testid="video-stage"]')).toBeTruthy();
    expect(wrapper.get('[data-testid="video-dropzone"]')).toBeTruthy();
    expect(wrapper.get('[data-testid="transport-bar"]')).toBeTruthy();
    expect(wrapper.get('[data-testid="timeline-track"]')).toBeTruthy();
  });

  it('shows the loaded filename in the top bar', async () => {
    const wrapper = mount(App);

    await loadVideo(wrapper);

    expect(wrapper.get('[data-testid="top-bar"]').text()).toContain('movie.mp4');
  });

  it('animates toast visibility, supports manual dismissal, and auto-dismisses after 5 seconds', async () => {
    vi.useFakeTimers();

    try {
      const wrapper = mount(App);

      expect(wrapper.get('[data-testid="status-message"]').text()).toContain('Load a local video to begin annotating.');

      await wrapper.get('[data-testid="toast-dismiss"]').trigger('click');
      await nextTick();
      expect(wrapper.find('[data-testid="status-message"]').exists()).toBe(false);

      await wrapper.get('[data-testid="toggle-mute"]').trigger('click');
      await nextTick();
      expect(wrapper.get('[data-testid="error-message"]').text()).toContain('Load a video before marking a segment.');

      await vi.advanceTimersByTimeAsync(5000);
      await nextTick();
      expect(wrapper.find('[data-testid="error-message"]').exists()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('creates, focuses, edits, and deletes a segment using toggle-based marking', async () => {
    const wrapper = mount(App);
    const video = await loadVideo(wrapper);

    video.currentTime = 10;
    video.dispatchEvent(new Event('timeupdate'));
    await nextTick();
    await wrapper.get('[data-testid="toggle-mute"]').trigger('click');

    expect(wrapper.get('[data-testid="toggle-mute"]').text()).toContain('Close active mute range');

    video.currentTime = 15;
    video.dispatchEvent(new Event('timeupdate'));
    await nextTick();
    await wrapper.get('[data-testid="toggle-mute"]').trigger('click');

    expect(getEditableText(wrapper, '[data-testid="segment-start-edit"]')).toBe('00:10.000');
    expect(getEditableText(wrapper, '[data-testid="segment-end-edit"]')).toBe('00:15.000');
    await wrapper.get('.segment-card-surface').trigger('click');
    expect(video.currentTime).toBe(10);

    await editContentEditable(wrapper, '[data-testid="segment-start-edit"]', '00:12.000');
    expect(getEditableText(wrapper, '[data-testid="segment-start-edit"]')).toBe('00:12.000');
    expect(getEditableText(wrapper, '[data-testid="segment-end-edit"]')).toBe('00:15.000');
    expect(wrapper.text()).toContain('MUTE');

    await wrapper.get('[data-testid="segment-delete"]').trigger('click');
    expect(wrapper.text()).toContain('Timeline is empty');
  });

  it('shows validation feedback when a selected segment becomes invalid', async () => {
    const wrapper = mount(App);
    const video = await loadVideo(wrapper);

    video.currentTime = 20;
    video.dispatchEvent(new Event('timeupdate'));
    await nextTick();
    await wrapper.get('[data-testid="toggle-skip"]').trigger('click');

    video.currentTime = 30;
    video.dispatchEvent(new Event('timeupdate'));
    await nextTick();
    await wrapper.get('[data-testid="toggle-skip"]').trigger('click');

    await editContentEditable(wrapper, '[data-testid="segment-start-edit"]', '00:35.000');

    expect(wrapper.get('[data-testid="validation-summary"]').text()).toContain('issue');
  });

  it('scrolls the newly added segment into view', async () => {
    const wrapper = mount(App);
    const video = await loadVideo(wrapper);

    video.currentTime = 10;
    video.dispatchEvent(new Event('timeupdate'));
    await nextTick();
    await wrapper.get('[data-testid="toggle-mute"]').trigger('click');

    video.currentTime = 15;
    video.dispatchEvent(new Event('timeupdate'));
    await nextTick();
    await wrapper.get('[data-testid="toggle-mute"]').trigger('click');
    await nextTick();

    const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView
    });

    try {
      video.currentTime = 30;
      video.dispatchEvent(new Event('timeupdate'));
      await nextTick();
      await wrapper.get('[data-testid="toggle-skip"]').trigger('click');

      video.currentTime = 36;
      video.dispatchEvent(new Event('timeupdate'));
      await nextTick();
      await wrapper.get('[data-testid="toggle-skip"]').trigger('click');
      await nextTick();
      await nextTick();

      expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' });
      expect(wrapper.findAll('.segment-card')[1]?.classes()).toContain('segment-card-selected');
    } finally {
      if (originalScrollIntoView) {
        Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
          configurable: true,
          value: originalScrollIntoView
        });
      } else {
        Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
      }
    }
  });

  it('imports filters and exports normalized JSON', async () => {
    const wrapper = mount(App);
    await loadVideo(wrapper);

    const importInput = wrapper.get('[data-testid="filters-input"]').element as HTMLInputElement;
    const filterFile = new File(
      [
        JSON.stringify({
          version: 1,
          movie: { title: 'Imported', duration: 120 },
          filters: [{ id: 'seg-1', type: 'mute', start: 5, end: 8 }]
        })
      ],
      'filters.json',
      { type: 'application/json' }
    );
    Object.defineProperty(filterFile, 'text', {
      configurable: true,
      value: async () =>
        JSON.stringify({
          version: 1,
          movie: { title: 'Imported', duration: 120 },
          filters: [{ id: 'seg-1', type: 'mute', start: 5, end: 8 }]
        })
    });

    assignFiles(importInput, [filterFile]);
    importInput.dispatchEvent(new Event('change'));
    await flushPromises();
    await nextTick();

    expect(wrapper.text()).toContain('Imported 1 segment');

    await wrapper.get('[data-testid="export-button"]').trigger('click');
    expect(lastExportBlob).toBeDefined();
    await expect(readBlobText(lastExportBlob as Blob)).resolves.toContain('"id": "seg-1"');
  });

  it('supports the new keyboard shortcuts, fine seek, custom transport, and timeline seeking', async () => {
    const wrapper = mount(App);
    const video = await loadVideo(wrapper);

    video.currentTime = 20;
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'm' }));
    video.currentTime = 30;
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'm' }));
    await wrapper.vm.$nextTick();

    expect(getEditableText(wrapper, '[data-testid="segment-start-edit"]')).toBe('00:20.000');
    expect(getEditableText(wrapper, '[data-testid="segment-end-edit"]')).toBe('00:30.000');

    video.currentTime = 40;
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
    await wrapper.vm.$nextTick();
    expect(video.currentTime).toBe(35);

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true }));
    await wrapper.vm.$nextTick();
    expect(video.currentTime).toBeCloseTo(35.1, 4);

    await wrapper.get('.segment-card-surface').trigger('click');
    expect(video.currentTime).toBe(20);

    const timeline = wrapper.get('[data-testid="timeline-track"]').element as HTMLButtonElement;
    timeline.getBoundingClientRect = vi.fn(() => ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 200,
      bottom: 40,
      width: 200,
      height: 40,
      toJSON: () => ({})
    }));

    timeline.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 100 }));
    await wrapper.vm.$nextTick();
    expect(video.currentTime).toBe(60);

    const timelineElement = wrapper.get('[data-testid="timeline-track"]').element as HTMLButtonElement;
    timelineElement.dispatchEvent(createPointerEvent('pointerdown', 50));
    timelineElement.dispatchEvent(createPointerEvent('pointermove', 150));
    timelineElement.dispatchEvent(createPointerEvent('pointerup', 150));
    await wrapper.vm.$nextTick();
    expect(video.currentTime).toBe(90);

    await wrapper.get('[aria-label="Play video"]').trigger('click');
    expect(playMock).toHaveBeenCalled();
  });

  it('scrolls to and highlights the matching segment when a timeline segment is clicked', async () => {
    const wrapper = mount(App);
    const video = await loadVideo(wrapper);

    video.currentTime = 10;
    video.dispatchEvent(new Event('timeupdate'));
    await nextTick();
    await wrapper.get('[data-testid="toggle-mute"]').trigger('click');

    video.currentTime = 15;
    video.dispatchEvent(new Event('timeupdate'));
    await nextTick();
    await wrapper.get('[data-testid="toggle-mute"]').trigger('click');

    video.currentTime = 30;
    video.dispatchEvent(new Event('timeupdate'));
    await nextTick();
    await wrapper.get('[data-testid="toggle-skip"]').trigger('click');

    video.currentTime = 36;
    video.dispatchEvent(new Event('timeupdate'));
    await nextTick();
    await wrapper.get('[data-testid="toggle-skip"]').trigger('click');
    await nextTick();

    const segmentCards = wrapper.findAll('.segment-card');
    const scrollIntoView = vi.fn();
    (segmentCards[1]?.element as HTMLElement).scrollIntoView = scrollIntoView;

    await wrapper.findAll('[data-testid="timeline-segment"]')[1]?.trigger('click');
    await nextTick();
    await nextTick();

    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' });
    expect(segmentCards[1]?.classes()).toContain('segment-card-selected');
    expect(video.currentTime).toBe(30);
  });
});

afterEach(() => {
  URL.createObjectURL = originalCreateObjectURL;
  URL.revokeObjectURL = originalRevokeObjectURL;
  vi.restoreAllMocks();
});
