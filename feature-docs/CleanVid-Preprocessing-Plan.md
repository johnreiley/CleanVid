# CleanVid Preprocessing Plan

## Goal

Enable browser-based annotation for unsupported formats (e.g. MKV) by generating a temporary, browser-compatible preview file while preserving accurate timestamps for processing the original file.

---

# Core Concept

Separate the roles of files:

- Original file → used for final processing
- Preview file → used for playback and annotation

The preview file must:
- be fast to generate
- preserve timestamps exactly
- be compatible with HTML5 video

---

# Workflow Overview

1. User selects or links a video file (e.g. .mkv)
2. Server detects file type
3. If unsupported by browser:
   - generate preview file (MP4)
4. Browser loads preview file
5. User creates filters using preview
6. Processing step uses original file (not preview)
7. Preview file is cleaned up after processing (or cached)

---

# File Handling Rules

## Supported Input Types

- mp4 → no preprocessing required
- mkv → preprocessing required
- others → optional future support

---

## Preview File Naming

- input: `movie.mkv`
- preview: `movie.preview.mp4`

Alternative (safer):
- `movie.mkv.preview.mp4`

---

## Preview File Location

- same directory as source file (MVP)
OR
- temp/cache directory (future)

---

# Preprocessing Requirements

## Detection

- [ ] detect file extension
- [ ] determine if browser-compatible
- [ ] trigger preprocessing only when necessary

---

## Remux Strategy (Primary Path)

Use stream copy (no re-encoding):

```bash
ffmpeg -i input.mkv -c copy output.preview.mp4
```

Requirements:
- fast execution (no decoding/encoding)
- no quality loss
- timestamps preserved

---

## Codec Compatibility Check

Remux may fail if codecs are not supported in MP4.

Examples:
- compatible:
  - H.264 video
  - AAC audio
- incompatible:
  - DTS audio
  - some subtitle formats

Requirement:
- [ ] detect remux failure
- [ ] fallback to re-encode

---

## Fallback Encoding (Secondary Path)

If remux fails:

```bash
ffmpeg -i input.mkv -c:v libx264 -preset veryfast -crf 28 -c:a aac output.preview.mp4
```

Requirements:
- ensure browser compatibility
- prioritize speed over quality
- maintain reasonable timestamp accuracy

---

# Server Responsibilities

## Preview Generation

- [ ] expose function: `createPreview(inputPath)`
- [ ] check if preview already exists (cache)
- [ ] attempt remux
- [ ] fallback to encode on failure
- [ ] return preview path

---

## Preview Caching

- [ ] reuse preview if it already exists
- [ ] avoid regenerating unnecessarily

Optional:
- [ ] hash-based cache (future)

---

## Preview Serving

- [ ] serve preview file over HTTP
- [ ] endpoint example:
  - GET /preview/:filename

---

# Frontend Responsibilities

## Preview Loading

- [ ] request preview path from server
- [ ] set video source to preview URL
- [ ] handle loading state

---

## UX Feedback

- [ ] show "Preparing video..." during preprocessing
- [ ] handle errors gracefully

---

# Processing Requirements

## Input Source

- MUST use original file path (not preview)

---

## Timestamp Integrity

- preview timestamps must match original
- remux guarantees alignment
- encoded fallback may introduce slight drift

---

# Cleanup Strategy

- [ ] delete preview after processing completes

---

# Error Handling

- [ ] remux failure → fallback to encode
- [ ] preview generation failure → return error
- [ ] missing preview → regenerate

---

# Constraints

- no full file uploads (large files)
- no re-encoding unless required
- maintain fast startup time for annotation
- avoid unnecessary disk duplication

---

# Performance Expectations

## Remux

- typically seconds to under a minute
- dependent on disk speed

## Encode Fallback

- significantly slower (minutes)
- dependent on CPU

---

# Definition of Done

- MKV file can be loaded into app
- preview is generated automatically
- preview plays in browser
- timestamps align with original
- processing uses original file
- output video is correct
- preview file is cleaned up or cached
