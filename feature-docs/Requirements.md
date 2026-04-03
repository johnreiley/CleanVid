# CleanVid MVP Requirements

## 🎯 MVP Goal

> I can take a movie, mark segments, export a filter file, and generate a cleaned version that plays perfectly in Plex.

---

# 🧩 MVP Components

- 🎬 Annotator (Web UI)
- ⚙️ Processor (CLI using FFmpeg)
- 📄 Filter JSON (shared contract)

---

# 📄 1. Filter File Spec

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

## Requirements

- [ ] supports `mute` and `skip`
- [ ] times are seconds (float)
- [ ] `start < end` enforced
- [ ] unique `id`
- [ ] sorted on save

## Not in MVP

- categories (language/violence)
- ratings
- sharing
- metadata syncing with Plex

---

# 🎬 2. Annotator Requirements (Web App)

## Core Playback

- [ ] load local video file
- [ ] play / pause
- [ ] seek via timeline
- [ ] display current timestamp

---

## Marking Segments

- [ ] “mark start” button
- [ ] “mark end” button
- [ ] choose type: mute / skip
- [ ] creates segment immediately

---

## Segment Management

- [ ] list all segments
- [ ] click segment → seek to start
- [ ] edit start/end manually (input fields)
- [ ] delete segment

---

## Timeline Interaction

- [ ] scrub bar (native video is fine)
- [ ] optional: small visual markers (nice-to-have)

---

## Keyboard Shortcuts

- [ ] `S` → mark start
- [ ] `E` → mark end
- [ ] `← / →` → seek ±1–5 sec
- [ ] space → play/pause

---

## Export / Import

- [ ] export JSON file
- [ ] import existing JSON file

---

## Validation

- [ ] ensure start < end
- [ ] clamp to video duration
- [ ] overlapping segments (optional: handled in processor)

---

## Not in MVP

- waveform
- drag-to-resize segments
- zoomable timeline
- multi-track categories
- auto-detection

---

# ⚙️ 3. Processor Requirements (CLI)

## Input

```bash
cleanvid input.mp4 filters.json output.mp4
```

---

## Core Behavior

### Skip Handling

- [ ] remove segments entirely
- [ ] stitch remaining parts seamlessly
- [ ] no A/V desync

---

### Mute Handling

- [ ] silence audio during segments
- [ ] video remains intact

---

### Combined Behavior

- [ ] skip takes precedence over mute
- [ ] mute only applied to kept segments

---

## Timeline Processing

- [ ] sort filters
- [ ] merge overlaps
- [ ] generate clean timeline:
  - keep / mute / skip segments

---

## FFmpeg Integration

- [ ] generate correct filter graph
- [ ] handle multiple segments
- [ ] ensure output plays in Plex

---

## Output

- [ ] produces a single playable `.mp4`
- [ ] no broken timestamps
- [ ] reasonable encoding defaults

---

## Error Handling

- [ ] invalid JSON → clear error
- [ ] invalid time ranges → fail fast
- [ ] overlapping segments → auto-merge or warn

---

## Not in MVP

- GPU acceleration tuning
- fancy encoding presets
- subtitles handling
- multi-audio track support

---

# 🔁 Data Flow

```
[Annotator]
   ↓ export
filters.json
   ↓
[Processor CLI]
   ↓
output.mp4
   ↓
Plex
```

---

# 🧠 Key Architectural Decisions

## Timeline Authority = Processor

- Annotator can be messy
- Processor must be correct

---

## Skip = Structural Change

- Always implemented via trimming + concat
- Never via “fast forward”

---

## Mute = Filter

- Applied via FFmpeg volume filter
- Not separate clips

---

# ⚡ Suggested Build Order

## Step 1
- CLI with skip only
- prove concat works cleanly

## Step 2
- add mute support

## Step 3
- basic web annotator (no polish)

## Step 4
- import/export integration

---

# 🧪 Definition of Done

You can:

1. Load a movie  
2. Mark 2–3 segments  
3. Export filters  
4. Run CLI  
5. Watch output in Plex with:
   - skips working
   - muted sections silent
   - no glitches

---

# 💡 Optional (High ROI)

## Dry Run Mode

- [ ] `--dry-run` flag

Outputs:

```
KEEP 0 → 123.2
MUTE 123.2 → 128.9
SKIP 542 → 560
```

---
