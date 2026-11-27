# CleanVid

CleanVid is a local-first video cleanup tool for building a family-friendly cut that still plays cleanly in Plex or any normal media library.

Today the repo includes:
- a Vue 3 annotator with a small local backend
- a shared JSON filter format, import parsers, and timeline planner
- a Node/TypeScript CLI that renders the cleaned output with FFmpeg and prepares browser-safe previews when needed

## Current Functionality

CleanVid currently supports:
- opening a local video from the annotator with a native file picker
- marking `mute` and `skip` regions from the keyboard, action tiles, or the timeline
- editing segment start and end times inline
- selecting timeline regions to jump to matching segments
- importing and exporting filter JSON
- staging `.skp` imports for review before replacing the current timeline
- importing SVG timeline rects as `mute` or `skip` filters
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
- the built-in native dialogs for opening videos, choosing subtitle or transcript files, and browsing for an output path are Windows-only in the current build

## Install

```bash
npm install
```

## Development

Run the annotator:

```bash
npm run dev:annotator
```

Build individual workspace packages:

```bash
npm run build:shared
npm run build:cli
npm run build:annotator
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
  annotator/   Vue 3 + Vite annotator with local API endpoints and Windows-native picker dialogs
  cli/         Node CLI processor plus preview preparation and cache helpers
packages/
  shared/      filter schema, validation, SKP/SVG import parsers, profanity helpers, and timeline planning
```

## Annotator Workflow

1. Start the annotator with `npm run dev:annotator`.
2. Open the local Vite URL in your browser.
3. Click the empty stage or `Open Video` to choose a source file.
4. In the Media tab, optionally import existing filters from `.json` or `.skp`, or paste an SVG timeline for conversion into filters.
5. Annotate `mute` and `skip` ranges.
6. Optionally click `Auto-Detect Profanity` to open the analysis modal and generate draft mute suggestions from subtitles or a Media Transcription Studio transcript.
7. Review, seek through, and apply the suggestions you want.
8. Fine-tune timestamps or jump around from the timeline and segment list.
9. Export filters, or switch to Export mode to render the cleaned video.

The annotator currently opens:
- `.mp4`
- `.m4v`
- `.mov`
- `.webm`
- `.mkv`

Playback behavior:
- `.mp4`, `.m4v`, `.mov`, and `.webm` play directly
- `.mkv` creates a cached browser-safe preview automatically
- cached previews are stored under your OS temp directory in `cleanvid-preview-cache`
- cached previews are reused when possible and pruned on a best-effort basis after about 7 days
- MKV preview prep tries a fast remux first when the streams are already browser-safe, then falls back to encoding if needed
- preview encoding probes `h264_nvenc`, `h264_amf`, and `h264_qsv` before falling back to `libx264`
- lower-core machines, or systems without a usable hardware preview encoder, fall back to a lighter preview profile automatically
- processing still runs against the original source file, not the preview file
- preview playback simulates `skip` by jumping forward and `mute` by muting audio only while playing
- `skip` takes precedence over `mute`

Keyboard shortcuts:
- `M`: start/finish a mute segment
- `S`: start/finish a skip segment
- `Space`: play/pause
- `Left` / `Right`: seek by 5 seconds
- `Shift` + `Left` / `Right`: seek by 0.1 seconds

## Importing Existing Cut Lists

Filter JSON:
- `Import Filters` accepts standard CleanVid `*.json` files after a video is loaded
- imported JSON updates the current timeline and restores the saved title/duration metadata when present

SKP import:
- `Import Filters` also accepts `*.skp`
- SKP files are parsed into draft segments first, with malformed entries listed as warnings instead of silently failing
- applying a reviewed SKP import replaces the current timeline
- imported SKP entries keep category, severity, and description metadata visible in the annotator UI
- exported CleanVid JSON stays in the normal filter-file shape and does not write SKP-only metadata back out

SVG import:
- `Import SVG` converts pasted `<rect class="cuts">` segments into CleanVid filters
- rect `x` and `width` percentages are mapped against the currently loaded movie duration
- you can import the rects as either `mute` or `skip`
- SVG imports can either replace the current timeline or append to it
- SVG import requires a loaded video duration greater than zero

## Profanity Analysis

Open **Auto-Detect Profanity** from the Annotate tab. CleanVid analyzes English dialogue locally using either source or both together.

| Source | Selection |
| --- | --- |
| Embedded text subtitles | Choose **Embedded**. Use **Find embedded tracks** to select a specific track. Automatic selection skips known non-English and forced-only tracks. |
| External subtitles | Choose an `.srt`, `.vtt`, `.ass`, or `.ssa` file. It takes precedence over embedded subtitles. Set subtitles to **None** for transcript-only analysis. |
| Media Transcription Studio | Choose a v1 `.json` transcript for the original video and its first audio stream. Check filename, size, timing, and coverage warnings before approving detections. |

With both sources loaded, CleanVid checks distinctive dialogue throughout the video for subtitle synchronization. The modal shows the estimated offset and the number of anchors. Enter an offset in **Timing options** to shift subtitle times in seconds, then run detection again. Positive values move subtitles later. Suspected drift or a different cut leaves subtitle detections unresolved until synchronization can be verified.

Review counts refer to detected occurrences. A transcript occurrence appears once. A matching subtitle adds evidence to that result, and subtitles add separate flags for occurrences the transcript missed. When exact wording and cue timing suggest a match but the surrounding dialogue is inconclusive, the shared result has medium confidence. If CleanVid finds the word only in the subtitles, nearby unambiguous transcript words may suggest a reviewable interval. Otherwise, a subtitle detection may cover the entire cue. Repeated matches that share the same subtitle fallback range appear under a single expandable row, with individual review decisions for each occurrence. Segment timing, estimates, conflicts, low recognition probability, and source warnings require review. The recognition probability comes from MTS and may be unknown. Both sources can miss the same word.

Select a detection to seek one second before it. Open **Source evidence** to see the matching dialogue and use **Play original** or **Play muted** to compare. You can loop the excerpt, enter start and end times, nudge either endpoint by 100 ms, and save the edited interval. Approve or reject detections individually, use **Approve eligible high confidence**, or use **Approve visible ranges** to approve all pending items in the current filter that have a playable range. Choose **Transcript results** to bulk approve only flags backed by the transcript. Unresolved items need a valid range before approval, and bulk approval leaves rejected items alone.

Transcript word and segment ranges have zero default padding. In a dual-source run, word padding is configurable, contextual estimates add 150 ms on either side, and subtitle cues add 150 ms before and 250 ms after. Timing shown in the list includes that padding. Applying approved detections merges overlapping intervals and appends ordinary mute filters. Discarding the draft leaves the timeline intact.

Image subtitles are unsupported. Supply a text subtitle file or an existing MTS transcript when the video lacks usable embedded subtitles. CleanVid does not fetch subtitles or run speech recognition. Both file selectors use Windows-native dialogs in the current build.

### Reconciliation benchmark

A synthetic two-hour transcript with 20,000 words, 2,000 cues, and 1,000 corroborated detections took 0.87–0.92 seconds and used 75–78 MiB peak process RSS over three fresh Node 24 processes on an AMD EPYC 9V74 Linux host. Doubling the fixture to 40,000 words took 2.08 seconds and used 129 MiB peak RSS. These runs cover detection, dialogue alignment, and reconciliation with preloaded data.

## Export From The Annotator

The annotator can process the currently opened source file directly.

Export details:
- the default output path is next to the source file with `.cleaned` added to the name
- you can override the output path before exporting
- exported filters are also written beside the rendered file as `*.filters.json`
- export progress streams back into the UI while FFmpeg runs
- the output browse button uses the Windows-native save dialog in the current build

## CLI Usage

Build the CLI first:

```bash
npm run build:cli
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
- only filter file version `1` is currently supported

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
