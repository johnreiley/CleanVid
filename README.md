# CleanVid

CleanVid is a local-first video cleanup tool for building a family-friendly cut that still plays cleanly in Plex or any normal media library.

Today the repo includes:
- a Vue 3 annotator with a small local backend
- a shared JSON filter format and timeline planner
- a Node/TypeScript CLI that renders the cleaned output with FFmpeg

## Current Functionality

CleanVid currently supports:
- opening a local video from the annotator with a native file picker
- marking `mute` and `skip` regions from the keyboard, action tiles, or the timeline
- editing segment start and end times inline
- selecting timeline regions to jump to matching segments
- importing and exporting filter JSON
- previewing mute/skip behavior during playback without rendering a file first
- toggling preview playback on and off
- analyzing profanity into draft mute suggestions before applying them to the timeline
- exporting a cleaned video directly from the annotator with live progress updates
- running the same processing pipeline from the CLI

## Requirements

Install these first:
- Node.js 18+
- npm
- `ffmpeg` on your `PATH`
- `ffprobe` on your `PATH`

Annotator note:
- the built-in native file picker is Windows-only in the current build

## Install

```bash
npm install
```

## Development

Run the annotator:

```bash
npm run dev:annotator
```

Run tests:

```bash
npm test
```

Build everything:

```bash
npm run build
```

## Project Layout

```text
apps/
  annotator/   Vue 3 + Vite annotator with local API endpoints
  cli/         Node CLI processor and preview-prep helpers
packages/
  shared/      filter schema, validation, normalization, and timeline planning
```

## Annotator Workflow

1. Start the annotator with `npm run dev:annotator`.
2. Open the local Vite URL in your browser.
3. Click the empty stage or `Open Video` to choose a source file.
4. Annotate `mute` and `skip` ranges.
5. Optionally click `Auto-Detect Profanity` to open the analysis modal and generate draft mute suggestions from subtitles.
6. Review, seek through, and apply the suggestions you want.
7. Fine-tune timestamps or jump around from the timeline and segment list.
8. Export filters, or switch to Export mode to render the cleaned video.

The annotator currently opens:
- `.mp4`
- `.m4v`
- `.mov`
- `.webm`
- `.mkv`

Playback behavior:
- `.mp4`, `.m4v`, `.mov`, and `.webm` play directly
- `.mkv` creates a cached browser-safe preview automatically
- processing still runs against the original source file, not the preview file
- preview playback simulates `skip` by jumping forward and `mute` by muting audio only while playing
- `skip` takes precedence over `mute`

Keyboard shortcuts:
- `M`: start/finish a mute segment
- `S`: start/finish a skip segment
- `Space`: play/pause
- `Left` / `Right`: seek by 5 seconds
- `Shift` + `Left` / `Right`: seek by 0.1 seconds
- `Ctrl` + `+`: zoom the timeline in
- `Ctrl` + `-`: zoom the timeline out
- `Ctrl` + `0`: reset timeline zoom to `1x`

## Profanity Analysis

The Annotate tab includes an `Auto-Detect Profanity` button that opens a subtitle-based analysis modal. The flow creates draft `mute` suggestions instead of changing the timeline automatically.

How it works:
- CleanVid checks embedded text subtitle tracks first
- if the video has no usable subtitles, you can choose your own `.srt`, `.vtt`, `.ass`, or `.ssa` file in the modal
- detections are padded, merged, and shown as draft suggestions you can review before applying

Suggestion review behavior:
- draft suggestions stay separate from your filter timeline until you click `Apply all as mute filters`
- each suggestion shows its source: embedded subtitles or a subtitle file you provided
- clicking a suggestion seeks playback to its start time
- `Discard suggestions` clears the draft analysis results without changing your current filters

Current analysis scope:
- English-first profanity matching
- image-based subtitle tracks are ignored in v1
- if the video has no subtitles, the app prompts you to provide one yourself instead of using automatic remote or transcription fallbacks
- the modal suggests searching `https://www.opensubtitles.com/` if you need to find a subtitle file yourself

## Export From The Annotator

The annotator can process the currently opened source file directly.

Export details:
- the default output path is next to the source file with `.cleaned` added to the name
- you can override the output path before exporting
- exported filters are also written beside the rendered file as `*.filters.json`
- export progress streams back into the UI while FFmpeg runs

## CLI Usage

Build first:

```bash
npm run build
```

Then run:

```bash
node apps/cli/dist/index.js input.mp4 filters.json output.mp4
```

CLI shape:

```bash
cleanvid <input> <filters.json> <output>
```

What the CLI does:
- validates the filter file
- probes the media with `ffprobe`
- plans the keep, mute, and skip timeline
- trims skipped spans
- applies mute ranges only within retained spans
- encodes video as H.264 and audio as AAC
- prints stage updates plus live encode progress

The processor expects:
- at least one video stream
- at least one audio stream

## Filter File Format

```json
{
  "version": 1,
  "movie": {
    "title": "Optional",
    "duration": 7200
  },
  "filters": [
    {
      "id": "uuid",
      "type": "mute",
      "start": 123.2,
      "end": 128.9
    }
  ]
}
```

Rules:
- supported types are `mute` and `skip`
- times are seconds as finite numbers
- `start` must be less than `end`
- `movie.duration` must be zero or greater
- filter ids must be unique
- filters are normalized and sorted on parse/export
- processor-side timeline building clamps ranges to the actual media duration
- segments clamped completely outside the media duration are dropped
- `skip` overrides `mute` in overlapping ranges

## Current Scope Limits

Not implemented yet:
- multi-audio-track handling
- drag-to-resize segment editing
- non-English profanity detection
- OCR/image-subtitle profanity analysis
- Plex metadata sync
- GPU tuning controls

## Verification

Current repo checks:

```bash
npm test
npm run build
```

These cover:
- shared schema validation and timeline behavior
- CLI graph generation, progress parsing, and FFmpeg integration
- annotator open/import/export flows, preview playback, profanity analysis, keyboard shortcuts, and export progress
