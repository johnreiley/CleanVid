// @vitest-environment jsdom

import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App.vue';

const originalFetch = globalThis.fetch;
const originalCreateObjectURL = URL.createObjectURL;
const originalRevokeObjectURL = URL.revokeObjectURL;
let lastExportBlob: Blob | null = null;
let fetchMock: ReturnType<typeof vi.fn>;
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

function mockJsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      'Content-Type': 'application/json'
    },
    ...init
  });
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });

  return { promise, resolve, reject };
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
  let mutedState = false;

  Object.defineProperty(video, 'duration', {
    configurable: true,
    value: duration
  });
  video.currentTime = current;
  Object.defineProperty(video, 'muted', {
    configurable: true,
    get: () => mutedState,
    set: (value: boolean) => {
      mutedState = Boolean(value);
    }
  });
  video.muted = false;
  Object.defineProperty(video, 'paused', {
    configurable: true,
    get: () => true
  });
}

async function openVideo(
  wrapper: ReturnType<typeof mount>,
  responseBody: Record<string, unknown> = {
    cancelled: false,
    inputPath: 'C:\\Movies\\movie.mp4',
    name: 'movie.mp4',
    outputPath: 'C:\\Movies\\movie.cleaned.mp4',
    playbackUrl: '/api/media/token-1',
    playbackSource: 'original'
  }
) {
  fetchMock.mockResolvedValueOnce(mockJsonResponse(responseBody));

  const sidebarOpenButton = wrapper.find('[data-testid="open-video-button"]');
  const stageOpenButton = wrapper.find('[data-testid="stage-open-video-button"]');

  if (sidebarOpenButton.exists()) {
    await sidebarOpenButton.trigger('click');
  } else if (stageOpenButton.exists()) {
    await stageOpenButton.trigger('click');
  }

  await flushPromises();
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
  fetchMock = vi.fn(() => Promise.reject(new Error('Unexpected fetch request.')));

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
  globalThis.fetch = fetchMock as typeof fetch;
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

  it('defaults Processing and Segments expanded, and lets both sections toggle', async () => {
    const wrapper = mount(App);

    expect(wrapper.find('[data-testid="processing-section-content"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="segments-section-content"]').exists()).toBe(true);

    await wrapper.get('[data-testid="toggle-processing-section"]').trigger('click');
    await nextTick();
    expect(wrapper.find('[data-testid="processing-section-content"]').exists()).toBe(false);

    await wrapper.get('[data-testid="toggle-segments-section"]').trigger('click');
    await nextTick();
    expect(wrapper.find('[data-testid="segments-section-content"]').exists()).toBe(false);
  });

  it('shows the loaded filename in the top bar', async () => {
    const wrapper = mount(App);

    await openVideo(wrapper);

    expect(wrapper.get('[data-testid="top-bar"]').text()).toContain('movie.mp4');
    expect(wrapper.get('[data-testid="preview-toggle"]').text()).toContain('Preview On');
  });

  it('opens a video for playback and keeps it when the picker is cancelled', async () => {
    const wrapper = mount(App);

    fetchMock
      .mockResolvedValueOnce(
        mockJsonResponse({
          cancelled: false,
          inputPath: 'C:\\Movies\\movie.mp4',
          name: 'movie.mp4',
          outputPath: 'C:\\Movies\\movie.cleaned.mp4',
          playbackUrl: '/api/media/token-1',
          playbackSource: 'original'
        })
      )
      .mockResolvedValueOnce(mockJsonResponse({ cancelled: true }));

    await wrapper.get('[data-testid="stage-open-video-button"]').trigger('click');
    await flushPromises();
    await nextTick();

    const video = wrapper.get('[data-testid="video-player"]').element as HTMLVideoElement;
    setVideoMetrics(video, 120, 0);
    video.dispatchEvent(new Event('loadedmetadata'));
    await nextTick();
    expect(wrapper.get('[data-testid="top-bar"]').text()).toContain('movie.mp4');
    expect((wrapper.get('[data-testid="output-path-input"]').element as HTMLInputElement).value).toBe(
      'C:\\Movies\\movie.cleaned.mp4'
    );
    expect((wrapper.get('[data-testid="process-video-button"]').element as HTMLButtonElement).disabled).toBe(
      false
    );

    await wrapper.get('[data-testid="open-video-button"]').trigger('click');
    await flushPromises();
    await nextTick();

    expect(wrapper.get('[data-testid="top-bar"]').text()).toContain('movie.mp4');
    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/open-video', undefined);
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/open-video', undefined);
  });

  it('shows a preparing state while the backend opens a video', async () => {
    const wrapper = mount(App);
    const openRequest = createDeferred<Response>();
    fetchMock.mockReturnValueOnce(openRequest.promise);

    await wrapper.get('[data-testid="stage-open-video-button"]').trigger('click');
    await nextTick();
    expect(wrapper.get('[data-testid="status-message"]').text()).toContain('Preparing video...');

    openRequest.resolve(
      mockJsonResponse({
        cancelled: false,
        inputPath: 'C:\\Movies\\movie.mp4',
        name: 'movie.mp4',
        outputPath: 'C:\\Movies\\movie.cleaned.mp4',
        playbackUrl: '/api/media/token-1',
        playbackSource: 'original'
      })
    );

    await flushPromises();
    await nextTick();
    expect(wrapper.get('[data-testid="open-video-button"]').text()).toContain('Open Video');
    expect((wrapper.get('[data-testid="process-video-button"]').element as HTMLButtonElement).disabled).toBe(
      false
    );
  });

  it('shows backend validation errors for unsupported formats and keeps processing disabled', async () => {
    const wrapper = mount(App);

    fetchMock.mockResolvedValueOnce(
      mockJsonResponse(
        {
          message: 'Unsupported video format. Open an .mp4, .m4v, .mov, .webm, or .mkv file.'
        },
        { status: 400 }
      )
    );

    await wrapper.get('[data-testid="stage-open-video-button"]').trigger('click');
    await flushPromises();
    await nextTick();

    expect(wrapper.get('[data-testid="error-message"]').text()).toContain('Unsupported video format.');
    expect((wrapper.get('[data-testid="process-video-button"]').element as HTMLButtonElement).disabled).toBe(
      true
    );
  });

  it('animates toast visibility, supports manual dismissal, and auto-dismisses after 5 seconds', async () => {
    vi.useFakeTimers();

    try {
      const wrapper = mount(App);

      expect(wrapper.get('[data-testid="status-message"]').text()).toContain('Open a local video to begin annotating.');

      await wrapper.get('[data-testid="toast-dismiss"]').trigger('click');
      await nextTick();
      expect(wrapper.find('[data-testid="status-message"]').exists()).toBe(false);

      await wrapper.get('[data-testid="toggle-mute"]').trigger('click');
      await nextTick();
      expect(wrapper.get('[data-testid="error-message"]').text()).toContain('Open a video before marking a segment.');

      await vi.advanceTimersByTimeAsync(5000);
      await nextTick();
      expect(wrapper.find('[data-testid="error-message"]').exists()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('creates, focuses, edits, and deletes a segment using toggle-based marking', async () => {
    const wrapper = mount(App);
    const video = await openVideo(wrapper);

    video.currentTime = 10;
    video.dispatchEvent(new Event('timeupdate'));
    await nextTick();
    await wrapper.get('[data-testid="toggle-mute"]').trigger('click');

    expect(wrapper.get('[data-testid="toggle-mute"]').classes()).toContain('action-tile-active');

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

  it('processes the opened video, disables processing while busy or invalid, and sends the expected payload', async () => {
    const wrapper = mount(App);

    await openVideo(wrapper, {
      cancelled: false,
      inputPath: 'C:\\Movies\\movie.mkv',
      name: 'movie.mkv',
      outputPath: 'C:\\Movies\\movie.cleaned.mkv',
      playbackUrl: '/api/media/token-preview',
      playbackSource: 'preview'
    });

    expect(wrapper.get('[data-testid="processing-section-content"]').text()).toContain(
      'Processing always uses the original source file, not the preview.'
    );

    const outputInput = wrapper.get('[data-testid="output-path-input"]').element as HTMLInputElement;
    outputInput.value = 'C:\\Exports\\custom-output.mp4';
    outputInput.dispatchEvent(new Event('input'));
    await nextTick();

    const processRequest = createDeferred<Response>();
    fetchMock.mockReturnValueOnce(processRequest.promise);

    await wrapper.get('[data-testid="process-video-button"]').trigger('click');
    await nextTick();

    expect(wrapper.get('[data-testid="process-video-button"]').text()).toContain('Processing...');
    expect((wrapper.get('[data-testid="process-video-button"]').element as HTMLButtonElement).disabled).toBe(
      true
    );

    processRequest.resolve(
      mockJsonResponse({
        outputPath: 'C:\\Exports\\custom-output.mp4',
        message: 'Processed video to C:\\Exports\\custom-output.mp4.'
      })
    );
    await flushPromises();
    await nextTick();

    const [, processInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    const processBody = JSON.parse(String(processInit.body)) as {
      inputPath: string;
      outputPath: string;
      filters: Array<{ id: string; type: string; start: number; end: number }>;
    };

    expect(processInit.method).toBe('POST');
    expect(processBody.inputPath).toBe('C:\\Movies\\movie.mkv');
    expect(processBody.outputPath).toBe('C:\\Exports\\custom-output.mp4');
    expect(processBody.filters).toEqual([]);
    expect(wrapper.get('[data-testid="status-message"]').text()).toContain(
      'Processed video to C:\\Exports\\custom-output.mp4.'
    );
    expect((wrapper.get('[data-testid="process-video-button"]').element as HTMLButtonElement).disabled).toBe(
      false
    );

    const video = await openVideo(wrapper);

    video.currentTime = 20;
    video.dispatchEvent(new Event('timeupdate'));
    await nextTick();
    await wrapper.get('[data-testid="toggle-skip"]').trigger('click');

    video.currentTime = 30;
    video.dispatchEvent(new Event('timeupdate'));
    await nextTick();
    await wrapper.get('[data-testid="toggle-skip"]').trigger('click');

    await editContentEditable(wrapper, '[data-testid="segment-start-edit"]', '00:35.000');

    expect((wrapper.get('[data-testid="process-video-button"]').element as HTMLButtonElement).disabled).toBe(
      true
    );
  });

  it('shows processing failures and resets the processing state', async () => {
    const wrapper = mount(App);

    await openVideo(wrapper)

    fetchMock
      .mockResolvedValueOnce(
        mockJsonResponse(
          {
            message: 'FFmpeg processing failed: boom'
          },
          { status: 500 }
        )
      );

    await wrapper.get('[data-testid="process-video-button"]').trigger('click');
    await flushPromises();
    await nextTick();

    expect(wrapper.get('[data-testid="error-message"]').text()).toContain(
      'FFmpeg processing failed: boom'
    );
    expect((wrapper.get('[data-testid="process-video-button"]').element as HTMLButtonElement).disabled).toBe(
      false
    );
  });

  it('shows validation feedback when a selected segment becomes invalid', async () => {
    const wrapper = mount(App);
    const video = await openVideo(wrapper);

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
    const video = await openVideo(wrapper);

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

  it('mutes audio only during playback inside mute segments and shows the preview hud', async () => {
    const wrapper = mount(App);
    const video = await openVideo(wrapper);

    video.currentTime = 10;
    video.dispatchEvent(new Event('timeupdate'));
    await nextTick();
    await wrapper.get('[data-testid="toggle-mute"]').trigger('click');

    video.currentTime = 15;
    video.dispatchEvent(new Event('timeupdate'));
    await nextTick();
    await wrapper.get('[data-testid="toggle-mute"]').trigger('click');

    video.currentTime = 12;
    video.dispatchEvent(new Event('timeupdate'));
    await nextTick();

    expect(video.muted).toBe(false);
    expect(wrapper.find('[data-testid="preview-hud"]').exists()).toBe(false);

    await wrapper.get('[aria-label="Play video"]').trigger('click');
    await nextTick();

    expect(video.muted).toBe(true);
    expect(wrapper.get('[data-testid="preview-hud"]').text()).toContain('Mute preview');

    await wrapper.get('[aria-label="Pause playback"]').trigger('click');
    await nextTick();

    expect(video.muted).toBe(false);
    expect(wrapper.find('[data-testid="preview-hud"]').exists()).toBe(false);
  });

  it('skips to the end of skip segments during playback', async () => {
    const wrapper = mount(App);
    const video = await openVideo(wrapper);

    video.currentTime = 20;
    video.dispatchEvent(new Event('timeupdate'));
    await nextTick();
    await wrapper.get('[data-testid="toggle-skip"]').trigger('click');

    video.currentTime = 30;
    video.dispatchEvent(new Event('timeupdate'));
    await nextTick();
    await wrapper.get('[data-testid="toggle-skip"]').trigger('click');

    video.currentTime = 22;
    video.dispatchEvent(new Event('timeupdate'));
    await nextTick();
    await wrapper.get('[aria-label="Play video"]').trigger('click');
    await nextTick();

    expect(video.currentTime).toBe(30);
  });

  it('does not preview mute or skip while paused, scrubbing, or stepping', async () => {
    const wrapper = mount(App);
    const video = await openVideo(wrapper);

    video.currentTime = 20;
    video.dispatchEvent(new Event('timeupdate'));
    await nextTick();
    await wrapper.get('[data-testid="toggle-skip"]').trigger('click');

    video.currentTime = 30;
    video.dispatchEvent(new Event('timeupdate'));
    await nextTick();
    await wrapper.get('[data-testid="toggle-skip"]').trigger('click');

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

    timeline.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 40 }));
    await nextTick();
    expect(video.currentTime).toBe(24);
    expect(wrapper.find('[data-testid="preview-hud"]').exists()).toBe(false);

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    await wrapper.vm.$nextTick();
    expect(video.currentTime).toBe(29);
    expect(wrapper.find('[data-testid="preview-hud"]').exists()).toBe(false);
  });

  it('leaves playback raw when preview is disabled', async () => {
    const wrapper = mount(App);
    const video = await openVideo(wrapper);

    video.currentTime = 20;
    video.dispatchEvent(new Event('timeupdate'));
    await nextTick();
    await wrapper.get('[data-testid="toggle-skip"]').trigger('click');

    video.currentTime = 30;
    video.dispatchEvent(new Event('timeupdate'));
    await nextTick();
    await wrapper.get('[data-testid="toggle-skip"]').trigger('click');

    await wrapper.get('[data-testid="preview-toggle"]').trigger('click');
    expect(wrapper.get('[data-testid="preview-toggle"]').text()).toContain('Preview Off');

    video.currentTime = 22;
    video.dispatchEvent(new Event('timeupdate'));
    await nextTick();
    await wrapper.get('[aria-label="Play video"]').trigger('click');
    await nextTick();

    expect(video.currentTime).toBe(22);
    expect(wrapper.find('[data-testid="preview-hud"]').exists()).toBe(false);
  });

  it('applies skip precedence over mute during preview playback', async () => {
    const wrapper = mount(App);
    const video = await openVideo(wrapper);

    video.currentTime = 10;
    video.dispatchEvent(new Event('timeupdate'));
    await nextTick();
    await wrapper.get('[data-testid="toggle-mute"]').trigger('click');

    video.currentTime = 20;
    video.dispatchEvent(new Event('timeupdate'));
    await nextTick();
    await wrapper.get('[data-testid="toggle-mute"]').trigger('click');

    video.currentTime = 15;
    video.dispatchEvent(new Event('timeupdate'));
    await nextTick();
    await wrapper.get('[data-testid="toggle-skip"]').trigger('click');

    video.currentTime = 18;
    video.dispatchEvent(new Event('timeupdate'));
    await nextTick();
    await wrapper.get('[data-testid="toggle-skip"]').trigger('click');

    video.currentTime = 16;
    video.dispatchEvent(new Event('timeupdate'));
    await nextTick();
    await wrapper.get('[aria-label="Play video"]').trigger('click');
    await nextTick();

    expect(video.currentTime).toBe(18);
    expect(video.muted).toBe(true);
    expect(wrapper.get('[data-testid="preview-hud"]').text()).toContain('Mute preview');
  });

  it('imports filters and exports normalized JSON', async () => {
    const wrapper = mount(App);
    await openVideo(wrapper);

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
    const video = await openVideo(wrapper);

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
    const video = await openVideo(wrapper);

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
  globalThis.fetch = originalFetch;
  URL.createObjectURL = originalCreateObjectURL;
  URL.revokeObjectURL = originalRevokeObjectURL;
  vi.restoreAllMocks();
});
