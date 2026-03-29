# CleanVid Hybrid Workflow Plan

## Goal

Create a smooth local workflow that allows:

Drop video -> mark segments -> link file -> process -> output video

Without:
- re-selecting files multiple times
- uploading large files
- duplicating video data

---

## Current State

Already in place:
- drag and drop video into the annotator
- browser playback via blob URL
- segment creation and editing for mute/skip ranges
- timeline and segment list management
- filter import/export and shared JSON handling
- playback preview for mute/skip behavior inside the annotator

This plan now focuses only on the missing UI-backend integration work.

---

## Core Idea

Separate responsibilities:

- Browser -> playback + annotation
- Node server -> file system + CLI execution

Use a hybrid approach:
- drag and drop for UX
- real file path for processing

---

## Remaining Workflow

1. User drags video into annotator
2. Browser plays video via blob URL
3. User creates segments
4. User clicks "Link File"
5. Server opens native file picker
6. Server returns real file path
7. User clicks "Process"
8. CLI runs using real file path
9. Output file is generated

---

## Annotator Requirements

### File Linking

- [ ] "Link File" button
- [ ] call server endpoint to open file picker
- [ ] receive file path from server
- [ ] store file path in state

---

### Validation

- [ ] ensure linked file exists
- [ ] warn if no file linked before processing

---

### Processing Trigger

- [ ] "Process Video" button
- [ ] send:
  - filters
  - input file path
  - output file path

---

## Server Requirements

### File Picker

- [ ] endpoint: `GET /select-file`
- [ ] open native file dialog
- [ ] filter for video files (`.mp4`, `.mkv`, etc.)
- [ ] return selected file path

---

### Processing Endpoint

- [ ] endpoint: `POST /process`
- [ ] accept:
  - filters
  - inputPath
  - outputPath
- [ ] write temp `filters.json`
- [ ] call CLI processor
- [ ] return status

---

### CLI Execution

- [ ] spawn CLI process
- [ ] pass correct arguments
- [ ] log stdout/stderr

---

### Output Handling

- [ ] save output next to input file
- [ ] naming convention:
  `input.mp4 -> input.cleaned.mp4`

---

## Data Handling

### File Path State

- [ ] persist last selected file path (optional)
- [ ] reuse for next session

---

## Constraints

- no file uploads
- browser cannot access file system directly
- Node server handles all file operations

---

## UX Improvements (Optional)

- [ ] disable "Process" until file linked
- [ ] show processing status (loading / done)
- [ ] auto-fill output file name

---

## Future Enhancements

- [ ] auto-match dropped file to system path
- [ ] batch processing
- [ ] progress streaming from FFmpeg
- [ ] desktop wrapper (Electron or Tauri)

---

## Definition of Done

- user drags video into app
- user creates filters
- user links file once
- user processes video
- output video is created correctly
- no duplicate file copies occur

---
