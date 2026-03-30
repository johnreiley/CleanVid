// @vitest-environment jsdom

import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App.vue';

const originalFetch = globalThis.fetch;
const originalCreateObjectURL = URL.createObjectURL;
const originalRevokeObjectURL = URL.revokeObjectURL;
const originalConfirm = window.confirm;
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

function createNdjsonResponse() {
  const encoder = new TextEncoder();
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({
    start(nextController) {
      controller = nextController;
    }
  });

  return {
    response: new Response(stream, {
      status: 200,
      headers: {
        'Content-Type': 'application/x-ndjson'
      }
    }),
    push(event: unknown) {
      controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
    },
    close() {
      controller.close();
    }
  };
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

function createBeforeUnloadEvent() {
  const event = new Event('beforeunload', { cancelable: true }) as BeforeUnloadEvent & {
    returnValue: string;
  };
  let returnValue = '__unset__';

  Object.defineProperty(event, 'returnValue', {
    configurable: true,
    get: () => returnValue,
    set: (value: string) => {
      returnValue = value;
    }
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
  const sidebarOpenButton = wrapper.find('[data-testid="open-video-button"]');
  const mediaModeButton = wrapper.find('[data-testid="mode-media-button"]');
  const videoDropzone = wrapper.find('[data-testid="video-dropzone"]');

  fetchMock.mockResolvedValueOnce(mockJsonResponse(responseBody));

  if (!sidebarOpenButton.exists() && mediaModeButton.exists()) {
    await mediaModeButton.trigger('click');
    await nextTick();
  }

  const activeSidebarOpenButton = wrapper.find('[data-testid="open-video-button"]');

  if (activeSidebarOpenButton.exists()) {
    await activeSidebarOpenButton.trigger('click');
  } else if (videoDropzone.exists()) {
    await videoDropzone.trigger('click');
  }

  await flushPromises();
  await nextTick();

  const video = wrapper.get('[data-testid="video-player"]').element as HTMLVideoElement;
  setVideoMetrics(video, 120, 0);
  video.dispatchEvent(new Event('loadedmetadata'));
  await nextTick();

  return video;
}

async function switchMode(
  wrapper: ReturnType<typeof mount>,
  mode: 'media' | 'annotate' | 'export'
) {
  await wrapper.get(`[data-testid="mode-${mode}-button"]`).trigger('click');
  await nextTick();
}

async function openProfanityModal(wrapper: ReturnType<typeof mount>) {
  await wrapper.get('[data-testid="open-profanity-modal-button"]').trigger('click');
  await nextTick();
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
  window.confirm = vi.fn(() => true);
  HTMLMediaElement.prototype.play = playMock;
  HTMLMediaElement.prototype.pause = pauseMock;
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
});

describe('annotator app', () => {
  it('renders the compact editor shell', () => {
    const wrapper = mount(App);

    expect(wrapper.get('[data-testid="workspace"]')).toBeTruthy();
    expect(wrapper.get('[data-testid="markers-panel"]')).toBeTruthy();
    expect(wrapper.get('[data-testid="stage-shell"]')).toBeTruthy();
    expect(wrapper.get('[data-testid="top-bar"]')).toBeTruthy();
    expect(wrapper.get('[data-testid="video-stage"]')).toBeTruthy();
    expect(wrapper.get('[data-testid="video-dropzone"]')).toBeTruthy();
    expect(wrapper.get('[data-testid="timeline-track"]')).toBeTruthy();
    expect(wrapper.get('[data-testid="mode-switch"]')).toBeTruthy();
    expect(wrapper.get('[data-testid="mode-panel-media"]')).toBeTruthy();
    expect(wrapper.find('[data-testid="loaded-video-name"]').exists()).toBe(false);
  });

  it('opens the picker when clicking the empty video stage and removes the redundant stage button', async () => {
    const wrapper = mount(App);

    expect(wrapper.find('[data-testid="stage-open-video-button"]').exists()).toBe(false);

    fetchMock.mockResolvedValueOnce(
      mockJsonResponse({
        cancelled: false,
        inputPath: 'C:\\Movies\\movie.mp4',
        name: 'movie.mp4',
        outputPath: 'C:\\Movies\\movie.cleaned.mp4',
        playbackUrl: '/api/media/token-1',
        playbackSource: 'original'
      })
    );

    await wrapper.get('[data-testid="video-dropzone"]').trigger('click');
    await flushPromises();
    await nextTick();

    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/open-video', undefined);
  });

  it('defaults to Media mode, auto-switches to Annotate after open, and allows manual mode changes', async () => {
    const wrapper = mount(App);

    expect(wrapper.find('[data-testid="mode-panel-media"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="mode-panel-annotate"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="mode-panel-export"]').exists()).toBe(false);

    await openVideo(wrapper);

    expect(wrapper.find('[data-testid="mode-panel-media"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="mode-panel-annotate"]').exists()).toBe(true);

    await switchMode(wrapper, 'export');
    await nextTick();
    expect(wrapper.find('[data-testid="mode-panel-export"]').exists()).toBe(true);

    await switchMode(wrapper, 'media');
    await nextTick();
    expect(wrapper.find('[data-testid="mode-panel-media"]').exists()).toBe(true);
  });

  it('keeps the sidebar content trimmed to the requested tab features', async () => {
    const wrapper = mount(App);

    expect(wrapper.find('[data-testid="loaded-video-name"]').exists()).toBe(false);
    expect((wrapper.get('[data-testid="filters-input"]').element as HTMLInputElement).disabled).toBe(true);

    await openVideo(wrapper);
    await switchMode(wrapper, 'media');

    expect(wrapper.get('[data-testid="loaded-video-name"]').text()).toContain('movie.mp4');
    expect((wrapper.get('[data-testid="filters-input"]').element as HTMLInputElement).disabled).toBe(false);

    await switchMode(wrapper, 'annotate');
    expect(wrapper.get('[data-testid="mode-panel-annotate"]').text()).toContain('Actions');
    expect(wrapper.get('[data-testid="segments-section-content"]').text()).toContain('Filter timeline');
    expect(wrapper.get('[data-testid="open-profanity-modal-button"]').text()).toContain(
      'Auto-Detect Profanity'
    );
    expect(wrapper.find('[data-testid="profanity-modal"]').exists()).toBe(false);
    await openProfanityModal(wrapper);
    expect(wrapper.get('[data-testid="profanity-capability-notice"]').text()).toContain(
      'Whisper Base fallback is not configured.'
    );
    expect((wrapper.get('[data-testid="enhanced-mode-toggle"]').element as HTMLInputElement).disabled).toBe(
      true
    );
    await wrapper.get('[data-testid="close-profanity-modal-button"]').trigger('click');
    await nextTick();

    await switchMode(wrapper, 'export');
    expect(wrapper.get('[data-testid="processing-section-content"]').text()).toContain('Filter count');
    expect(wrapper.get('[data-testid="filter-count-value"]').text()).toContain('0 markers');
  });

  it('shows the loaded filename in the top bar', async () => {
    const wrapper = mount(App);

    await openVideo(wrapper);

    expect(wrapper.get('[data-testid="top-bar"]').text()).toContain('movie.mp4');
    expect(wrapper.find('[data-testid="mode-panel-annotate"]').exists()).toBe(true);
    expect(wrapper.get('[data-testid="preview-toggle"]').text()).toContain('Preview On');
  });

  it('enables profanity analysis only after a video is loaded and only enables remote fallback when configured', async () => {
    const wrapper = mount(App);

    await switchMode(wrapper, 'annotate');
    expect(
      (wrapper.get('[data-testid="open-profanity-modal-button"]').element as HTMLButtonElement).disabled
    ).toBe(true);

    await openVideo(wrapper, {
      cancelled: false,
      inputPath: 'C:\\Movies\\movie.mp4',
      name: 'movie.mp4',
      outputPath: 'C:\\Movies\\movie.cleaned.mp4',
      playbackUrl: '/api/media/token-1',
      playbackSource: 'original',
      analysisCapabilities: {
        remoteSubtitlesAvailable: true,
        whisperBaseAvailable: true,
        whisperTinyAvailable: true
      }
    });

    expect(
      (wrapper.get('[data-testid="open-profanity-modal-button"]').element as HTMLButtonElement).disabled
    ).toBe(false);
    await openProfanityModal(wrapper);
    expect(wrapper.get('[data-testid="analyze-profanity-button"]').element).toBeTruthy();
    expect((wrapper.get('[data-testid="enhanced-mode-toggle"]').element as HTMLInputElement).disabled).toBe(
      false
    );
    expect(
      (wrapper.get('[data-testid="allow-remote-subtitles-toggle"]').element as HTMLInputElement).disabled
    ).toBe(false);
  });

  it('does not reopen the picker when clicking the stage after a video is loaded', async () => {
    const wrapper = mount(App);

    await openVideo(wrapper);
    fetchMock.mockClear();

    await wrapper.get('[data-testid="video-dropzone"]').trigger('click');
    await flushPromises();
    await nextTick();

    expect(fetchMock).not.toHaveBeenCalled();
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

    await wrapper.get('[data-testid="video-dropzone"]').trigger('click');
    await flushPromises();
    await nextTick();

    const video = wrapper.get('[data-testid="video-player"]').element as HTMLVideoElement;
    setVideoMetrics(video, 120, 0);
    video.dispatchEvent(new Event('loadedmetadata'));
    await nextTick();
    expect(wrapper.get('[data-testid="top-bar"]').text()).toContain('movie.mp4');
    await switchMode(wrapper, 'export');
    expect((wrapper.get('[data-testid="output-path-input"]').element as HTMLInputElement).value).toBe(
      'C:\\Movies\\movie.cleaned.mp4'
    );
    expect((wrapper.get('[data-testid="process-video-button"]').element as HTMLButtonElement).disabled).toBe(
      false
    );

    await switchMode(wrapper, 'media');
    await wrapper.get('[data-testid="open-video-button"]').trigger('click');
    await flushPromises();
    await nextTick();

    expect(wrapper.get('[data-testid="top-bar"]').text()).toContain('movie.mp4');
    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/open-video', undefined);
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/open-video', undefined);
  });

  it('prompts to export unexported filters before opening another video and resets the timeline', async () => {
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

    fetchMock.mockClear();
    lastExportBlob = null;

    const confirmMock = window.confirm as unknown as ReturnType<typeof vi.fn>;
    confirmMock.mockReturnValueOnce(true);
    fetchMock.mockResolvedValueOnce(
      mockJsonResponse({
        cancelled: false,
        inputPath: 'C:\\Movies\\next-movie.mp4',
        name: 'next-movie.mp4',
        outputPath: 'C:\\Movies\\next-movie.cleaned.mp4',
        playbackUrl: '/api/media/token-2',
        playbackSource: 'original'
      })
    );

    await switchMode(wrapper, 'media');
    await wrapper.get('[data-testid="open-video-button"]').trigger('click');
    await flushPromises();
    await nextTick();

    const reloadedVideo = wrapper.get('[data-testid="video-player"]').element as HTMLVideoElement;
    setVideoMetrics(reloadedVideo, 90, 0);
    reloadedVideo.dispatchEvent(new Event('loadedmetadata'));
    await nextTick();

    expect(confirmMock).toHaveBeenCalledWith(
      'You have unexported filter changes. Select OK to export them before opening another video.'
    );
    expect(lastExportBlob).toBeTruthy();
    if (!lastExportBlob) {
      throw new Error('Expected export blob to be created.');
    }
    await expect(readBlobText(lastExportBlob)).resolves.toContain('"type": "mute"');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('/api/open-video', undefined);
    expect(wrapper.get('[data-testid="top-bar"]').text()).toContain('next-movie.mp4');

    await switchMode(wrapper, 'annotate');
    expect(wrapper.text()).toContain('Timeline is empty');
  });

  it('keeps the current session when replacing a video is cancelled after the unsaved-filters prompt', async () => {
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

    fetchMock.mockClear();

    const confirmMock = window.confirm as unknown as ReturnType<typeof vi.fn>;
    confirmMock.mockReturnValueOnce(false).mockReturnValueOnce(false);

    await switchMode(wrapper, 'media');
    await wrapper.get('[data-testid="open-video-button"]').trigger('click');
    await flushPromises();
    await nextTick();

    expect(confirmMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(wrapper.get('[data-testid="top-bar"]').text()).toContain('movie.mp4');

    await switchMode(wrapper, 'annotate');
    expect(wrapper.findAll('.segment-card')).toHaveLength(1);
  });

  it('shows a preparing state while the backend opens a video', async () => {
    const wrapper = mount(App);
    const openRequest = createDeferred<Response>();
    fetchMock.mockReturnValueOnce(openRequest.promise);

    await wrapper.get('[data-testid="video-dropzone"]').trigger('click');
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
    expect(wrapper.find('[data-testid="mode-panel-annotate"]').exists()).toBe(true);
    await switchMode(wrapper, 'media');
    expect(wrapper.get('[data-testid="open-video-button"]').text()).toContain('Open Video');
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

    await wrapper.get('[data-testid="video-placeholder"]').trigger('click');
    await flushPromises();
    await nextTick();

    expect(wrapper.get('[data-testid="error-message"]').text()).toContain('Unsupported video format.');
    await switchMode(wrapper, 'export');
    expect((wrapper.get('[data-testid="process-video-button"]').element as HTMLButtonElement).disabled).toBe(
      true
    );
  });

  it('animates toast visibility, supports manual dismissal, and auto-dismisses after 5 seconds', async () => {
    vi.useFakeTimers();

    try {
      const wrapper = mount(App);

      expect(wrapper.get('[data-testid="status-message"]').text()).toContain('Open a video to begin annotating.');

      await wrapper.get('[data-testid="toast-dismiss"]').trigger('click');
      await nextTick();
      expect(wrapper.find('[data-testid="status-message"]').exists()).toBe(false);

      await switchMode(wrapper, 'annotate');
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

  it('shows a purple pending start marker on the timeline while a range is active, then removes it when completed', async () => {
    const wrapper = mount(App);
    const video = await openVideo(wrapper);

    expect(wrapper.find('[data-testid="timeline-pending-start"]').exists()).toBe(false);

    video.currentTime = 24;
    video.dispatchEvent(new Event('timeupdate'));
    await nextTick();
    await wrapper.get('[data-testid="toggle-mute"]').trigger('click');
    await nextTick();

    const pendingStart = wrapper.get('[data-testid="timeline-pending-start"]');
    expect((pendingStart.element as HTMLElement).style.left).toBe('20%');

    video.currentTime = 36;
    video.dispatchEvent(new Event('timeupdate'));
    await nextTick();
    await wrapper.get('[data-testid="toggle-mute"]').trigger('click');
    await nextTick();

    expect(wrapper.find('[data-testid="timeline-pending-start"]').exists()).toBe(false);
  });

  it('clears the pending timeline start marker when opening another video', async () => {
    const wrapper = mount(App);
    const video = await openVideo(wrapper);

    video.currentTime = 30;
    video.dispatchEvent(new Event('timeupdate'));
    await nextTick();
    await wrapper.get('[data-testid="toggle-skip"]').trigger('click');
    await nextTick();

    expect(wrapper.find('[data-testid="timeline-pending-start"]').exists()).toBe(true);

    await switchMode(wrapper, 'media');
    fetchMock.mockResolvedValueOnce(
      mockJsonResponse({
        cancelled: false,
        inputPath: 'C:\\Movies\\next-movie.mp4',
        name: 'next-movie.mp4',
        outputPath: 'C:\\Movies\\next-movie.cleaned.mp4',
        playbackUrl: '/api/media/token-2',
        playbackSource: 'original'
      })
    );

    await wrapper.get('[data-testid="open-video-button"]').trigger('click');
    await flushPromises();
    await nextTick();

    expect(wrapper.find('[data-testid="timeline-pending-start"]').exists()).toBe(false);
  });

  it('lets the user browse for an output path instead of typing it manually', async () => {
    const wrapper = mount(App);

    await openVideo(wrapper);
    await switchMode(wrapper, 'export');

    fetchMock.mockClear();

    const browseRequest = createDeferred<Response>();
    fetchMock.mockReturnValueOnce(browseRequest.promise);

    const browseButton = wrapper.get('[data-testid="output-path-browse-button"]');
    const outputInput = wrapper.get('[data-testid="output-path-input"]').element as HTMLInputElement;

    await browseButton.trigger('click');
    await nextTick();

    expect(browseButton.text()).toContain('Choosing...');
    expect((browseButton.element as HTMLButtonElement).disabled).toBe(true);

    browseRequest.resolve(
      mockJsonResponse({
        cancelled: false,
        outputPath: 'C:\\Exports\\picked-output.mp4'
      })
    );

    await flushPromises();
    await nextTick();

    const [browseUrl, browseInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(browseUrl).toBe('/api/select-output-path');
    expect(browseInit.method).toBe('POST');
    expect(browseInit.headers).toMatchObject({
      'Content-Type': 'application/json'
    });
    expect(JSON.parse(String(browseInit.body))).toEqual({
      outputPath: 'C:\\Movies\\movie.cleaned.mp4'
    });
    expect(outputInput.value).toBe('C:\\Exports\\picked-output.mp4');

    fetchMock.mockClear();
    fetchMock.mockResolvedValueOnce(
      mockJsonResponse({
        cancelled: true
      })
    );

    await browseButton.trigger('click');
    await flushPromises();
    await nextTick();

    expect(outputInput.value).toBe('C:\\Exports\\picked-output.mp4');
  });

  it('streams profanity analysis results, allows seeking suggestions, and applies them as mute filters', async () => {
    const wrapper = mount(App);
    const video = await openVideo(wrapper, {
      cancelled: false,
      inputPath: 'C:\\Movies\\movie.mp4',
      name: 'movie.mp4',
      outputPath: 'C:\\Movies\\movie.cleaned.mp4',
      playbackUrl: '/api/media/token-1',
      playbackSource: 'original',
      analysisCapabilities: {
        remoteSubtitlesAvailable: true,
        whisperBaseAvailable: true,
        whisperTinyAvailable: true
      }
    });

    fetchMock.mockClear();
    const analysisResponse = createNdjsonResponse();
    fetchMock.mockResolvedValueOnce(analysisResponse.response);

    await switchMode(wrapper, 'annotate');
    await openProfanityModal(wrapper);
    expect(wrapper.find('[data-testid="profanity-modal"]').exists()).toBe(true);
    await wrapper.get('[data-testid="enhanced-mode-toggle"]').setValue(true);
    await wrapper.get('[data-testid="allow-remote-subtitles-toggle"]').setValue(true);
    await wrapper.get('[data-testid="analyze-profanity-button"]').trigger('click');
    await nextTick();

    expect(wrapper.get('[data-testid="analyze-profanity-button"]').text()).toContain('Analyzing 0%');

    analysisResponse.push({
      type: 'progress',
      progress: {
        phase: 'transcribe-tiny',
        message: 'Running whisper.cpp tiny refinement...',
        percent: 52
      }
    });
    await flushPromises();
    await nextTick();

    expect(wrapper.get('[data-testid="analyze-profanity-button"]').text()).toContain('Analyzing 52%');

    analysisResponse.push({
      type: 'result',
      result: {
        suggestions: [
          {
            id: 'suggestion-1',
            start: 12,
            end: 13,
            snippet: 'oh shit',
            source: 'embedded',
            matchedTerms: ['shit']
          },
          {
            id: 'suggestion-2',
            start: 22,
            end: 23,
            snippet: 'what the fuck',
            source: 'whisper-tiny',
            matchedTerms: ['fuck']
          }
        ],
        usedSources: ['embedded', 'whisper-tiny'],
        subtitleCueCount: 2,
        remoteLookupUsed: false,
        whisperRefinementApplied: true,
        message: 'Detected 2 draft mute suggestions.'
      }
    });
    analysisResponse.close();
    await flushPromises();
    await nextTick();

    const [analysisUrl, analysisInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(analysisUrl).toBe('/api/analyze-profanity');
    expect(analysisInit.method).toBe('POST');
    expect(JSON.parse(String(analysisInit.body))).toEqual({
      inputPath: 'C:\\Movies\\movie.mp4',
      movieTitle: 'movie',
      options: {
        enhancedMode: true,
        allowRemoteSubtitles: true
      }
    });
    expect(wrapper.get('[data-testid="profanity-suggestion-count"]').text()).toContain('2 suggestions');
    expect(wrapper.get('[data-testid="profanity-suggestion-snippet"]').text()).toContain('oh shit');

    await wrapper.findAll('[data-testid="profanity-suggestion-seek"]')[1]?.trigger('click');
    expect(video.currentTime).toBe(22);

    await wrapper.get('[data-testid="apply-profanity-suggestions-button"]').trigger('click');
    await nextTick();

    expect(wrapper.find('[data-testid="profanity-modal"]').exists()).toBe(false);
    expect(wrapper.findAll('.segment-card')).toHaveLength(2);
    expect(wrapper.get('[data-testid="status-message"]').text()).toContain(
      'Applied 2 profanity suggestions as mute filters.'
    );
  });

  it('can discard draft profanity suggestions without changing the filter timeline', async () => {
    const wrapper = mount(App);

    await openVideo(wrapper, {
      cancelled: false,
      inputPath: 'C:\\Movies\\movie.mp4',
      name: 'movie.mp4',
      outputPath: 'C:\\Movies\\movie.cleaned.mp4',
      playbackUrl: '/api/media/token-1',
      playbackSource: 'original',
      analysisCapabilities: {
        remoteSubtitlesAvailable: false,
        whisperBaseAvailable: true,
        whisperTinyAvailable: true
      }
    });

    await switchMode(wrapper, 'annotate');
    await openProfanityModal(wrapper);
    fetchMock.mockClear();
    fetchMock.mockResolvedValueOnce(
      mockJsonResponse({
        suggestions: [
          {
            id: 'suggestion-1',
            start: 12,
            end: 13,
            snippet: 'damn',
            source: 'embedded',
            matchedTerms: ['damn']
          }
        ],
        usedSources: ['embedded'],
        subtitleCueCount: 1,
        remoteLookupUsed: false,
        whisperRefinementApplied: false,
        message: 'Detected 1 draft mute suggestion.'
      })
    );

    await wrapper.get('[data-testid="analyze-profanity-button"]').trigger('click');
    await flushPromises();
    await nextTick();

    expect(wrapper.get('[data-testid="profanity-suggestion-count"]').text()).toContain('1 suggestion');

    await wrapper.get('[data-testid="discard-profanity-suggestions-button"]').trigger('click');
    await nextTick();

    expect(wrapper.find('[data-testid="profanity-modal"]').exists()).toBe(false);
    await openProfanityModal(wrapper);
    expect(wrapper.get('[data-testid="profanity-suggestion-count"]').text()).toContain('0 suggestions');
    expect(wrapper.findAll('.segment-card')).toHaveLength(0);
  });

  it('shows export progress in the button, then completes processing with the expected payload', async () => {
    const wrapper = mount(App);

    await openVideo(wrapper, {
      cancelled: false,
      inputPath: 'C:\\Movies\\movie.mkv',
      name: 'movie.mkv',
      outputPath: 'C:\\Movies\\movie.cleaned.mkv',
      playbackUrl: '/api/media/token-preview',
      playbackSource: 'preview'
    });

    await switchMode(wrapper, 'export');
    expect(wrapper.get('[data-testid="filter-count-value"]').text()).toContain('0 markers');

    const outputInput = wrapper.get('[data-testid="output-path-input"]').element as HTMLInputElement;
    outputInput.value = 'C:\\Exports\\custom-output.mp4';
    outputInput.dispatchEvent(new Event('input'));
    await nextTick();

    const processResponse = createNdjsonResponse();
    fetchMock.mockResolvedValueOnce(processResponse.response);

    await wrapper.get('[data-testid="process-video-button"]').trigger('click');
    await nextTick();

    expect(wrapper.find('[data-testid="mode-panel-export"]').exists()).toBe(true);

    expect(wrapper.get('[data-testid="process-video-button"]').text()).toContain('Exporting 0%');
    expect((wrapper.get('[data-testid="process-video-button"]').element as HTMLButtonElement).disabled).toBe(
      true
    );
    expect((wrapper.get('[data-testid="process-progress-fill"]').element as HTMLElement).style.width).toBe(
      '0%'
    );

    processResponse.push({
      type: 'progress',
      progress: {
        phase: 'probe-media',
        message: 'Probing media...'
      }
    });
    await flushPromises();
    await nextTick();

    expect(wrapper.get('[data-testid="process-video-button"]').text()).toContain('Exporting 12%');
    expect((wrapper.get('[data-testid="process-progress-fill"]').element as HTMLElement).style.width).toBe(
      '12%'
    );

    processResponse.push({
      type: 'progress',
      progress: {
        phase: 'encode',
        message: 'Encoding output...',
        percent: 0.5
      }
    });
    await flushPromises();
    await nextTick();

    expect(wrapper.get('[data-testid="process-video-button"]').text()).toContain('Exporting 67%');
    expect((wrapper.get('[data-testid="process-progress-fill"]').element as HTMLElement).style.width).toBe(
      '67%'
    );

    processResponse.push({
      type: 'result',
      result: {
        outputPath: 'C:\\Exports\\custom-output.mp4',
        filtersPath: 'C:\\Exports\\custom-output.filters.json',
        message: 'Processed video to C:\\Exports\\custom-output.mp4.'
      }
    });
    processResponse.close();
    await flushPromises();
    await nextTick();

    const [, processInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    const processBody = JSON.parse(String(processInit.body)) as {
      inputPath: string;
      outputPath: string;
      filters: Array<{ id: string; type: string; start: number; end: number }>;
    };

    expect(processInit.method).toBe('POST');
    expect(processInit.headers).toMatchObject({
      Accept: 'application/x-ndjson',
      'Content-Type': 'application/json'
    });
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
    await switchMode(wrapper, 'annotate');

    video.currentTime = 20;
    video.dispatchEvent(new Event('timeupdate'));
    await nextTick();
    await wrapper.get('[data-testid="toggle-skip"]').trigger('click');

    video.currentTime = 30;
    video.dispatchEvent(new Event('timeupdate'));
    await nextTick();
    await wrapper.get('[data-testid="toggle-skip"]').trigger('click');

    await editContentEditable(wrapper, '[data-testid="segment-start-edit"]', '00:35.000');

    await switchMode(wrapper, 'export');
    expect((wrapper.get('[data-testid="process-video-button"]').element as HTMLButtonElement).disabled).toBe(
      true
    );
  });

  it('shows processing failures and resets the processing state', async () => {
    const wrapper = mount(App);

    await openVideo(wrapper)
    await switchMode(wrapper, 'export');

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
    await switchMode(wrapper, 'media');

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

    expect(wrapper.text()).toContain('Imported 1 filter.');

    await wrapper.get('[data-testid="export-button"]').trigger('click');
    expect(lastExportBlob).toBeDefined();
    await expect(readBlobText(lastExportBlob as Blob)).resolves.toContain('"id": "seg-1"');
  });

  it('warns before leaving the page when filter changes have not been exported yet', async () => {
    const addEventListenerSpy = vi.spyOn(window, 'addEventListener');
    const wrapper = mount(App);
    const beforeUnloadHandler = addEventListenerSpy.mock.calls.find(
      ([eventName]) => eventName === 'beforeunload'
    )?.[1] as EventListener;
    const video = await openVideo(wrapper);

    expect(beforeUnloadHandler).toBeTypeOf('function');

    video.currentTime = 10;
    video.dispatchEvent(new Event('timeupdate'));
    await nextTick();
    await wrapper.get('[data-testid="toggle-mute"]').trigger('click');

    video.currentTime = 15;
    video.dispatchEvent(new Event('timeupdate'));
    await nextTick();
    await wrapper.get('[data-testid="toggle-mute"]').trigger('click');

    const beforeUnloadEvent = createBeforeUnloadEvent();
    beforeUnloadHandler(beforeUnloadEvent);
    expect(beforeUnloadEvent.returnValue).toBe('');

    await wrapper.get('[data-testid="export-button"]').trigger('click');
    await nextTick();

    const afterExportEvent = createBeforeUnloadEvent();
    beforeUnloadHandler(afterExportEvent);
    expect(afterExportEvent.returnValue).toBe('__unset__');
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
  window.confirm = originalConfirm;
  vi.restoreAllMocks();
});
