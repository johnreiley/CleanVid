# CleanVid

CleanVid is a local-first tool for creating a cleaned movie cut that still plays cleanly in Plex.

It has three pieces:
- a Vue 3 annotator for marking `mute` and `skip` segments
- a shared JSON filter format
- a Node/TypeScript CLI that uses FFmpeg to render the cleaned `.mp4`

## What It Does

With the current MVP you can:
- load a local video in the browser
- mark mute and skip segments
- edit or delete segments
- import and export filter JSON
- process a source movie into a cleaned H.264/AAC MP4

## Requirements

Install these first:
- Node.js 18+
- npm
- `ffmpeg` on your `PATH`
- `ffprobe` on your `PATH`

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
  annotator/   Vue 3 + Vite web annotator
  cli/         Node CLI processor
packages/
  shared/      shared schema, validation, and timeline planning
```

## Annotator Usage

1. Start the annotator with `npm run dev:annotator`.
2. Open the local Vite URL in your browser.
3. Load a local video file.
4. Choose segment type: `mute` or `skip`.
5. Mark a start time and an end time.
6. Adjust segments in the list if needed.
7. Export the filter JSON.

Keyboard shortcuts:
- `S`: mark start
- `E`: mark end
- `Space`: play/pause
- `Left` / `Right`: seek by 5 seconds

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
cleanvid <input> <filters.json> <output.mp4>
```

Example:

```bash
node apps/cli/dist/index.js movie.mp4 movie.filters.json movie.cleaned.mp4
```

The processor:
- validates the filter file
- probes the media with `ffprobe`
- applies `skip` by trimming and concatenating kept spans
- applies `mute` only to retained spans
- encodes the result as H.264/AAC MP4 with `+faststart`

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
- times are seconds as numbers
- `start` must be less than `end`
- `id` values must be unique
- exported filters are sorted
- processor-time validation clamps ranges to media duration
- `skip` takes precedence over `mute`

## Output Notes

The MVP currently assumes:
- one primary video stream
- one primary audio stream
- no subtitle processing
- no multi-audio-track support

The output target is a single MP4 encoded as:
- video: H.264
- audio: AAC

## Known Scope Limits

Not in the current MVP:
- GPU tuning
- subtitle handling
- waveform editing
- drag-to-resize timeline editing
- Plex metadata sync
- dry-run CLI mode

## Verification

Current repo checks:

```bash
npm test
npm run build
```

These cover:
- shared schema and timeline behavior
- CLI integration with FFmpeg
- annotator import/export and shortcut flows
