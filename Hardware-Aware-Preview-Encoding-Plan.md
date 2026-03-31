# Hardware-Aware Preview Encoding

## Summary

- Keep the current flow: direct-play files bypass preprocessing, and MKV preview stays remux-first.
- Replace the single software encode fallback with an automatic encoder planner that runs only when remux is not possible or fails.
- Detect usable encoders by cached FFmpeg smoke tests, not Windows GPU inventory APIs. Probe `h264_nvenc`, `h264_amf`, and `h264_qsv` with a 128x72 one-frame `lavfi` input to a null output, cache the results for the process lifetime, and select in this order: `h264_nvenc` -> `h264_amf` -> `h264_qsv` -> `libx264`.
- Treat successful NVENC or AMF as the dedicated-GPU path. Use QSV only when dedicated-GPU encoders are not usable.
- Add a weak-machine profile when the chosen encoder is `h264_qsv`or `libx264`, or the machine has `<= 4` logical CPU cores. That profile keeps timing/frame rate unchanged but caps video to 480p.

## Implementation Changes

- Add an internal preview encode plan object with:
  - `encoder`: `h264_nvenc | h264_amf | h264_qsv | libx264`
  - `weakMachine`: boolean
  - `videoArgs`, `audioArgs`, and optional `filterArgs`
- Resolve the encode plan only after cache miss and only on the encode path. Direct-play, cache-hit, and successful remux paths should not pay probe cost.
- Use encoder-specific speed-first args:
  - `h264_nvenc`: `-preset p1 -rc vbr -cq 31 -b:v 0 -pix_fmt yuv420p`
  - `h264_amf`: `-usage transcoding -quality speed -rc qvbr -qvbr_quality_level 30 -pix_fmt nv12`
  - `h264_qsv`: `-preset veryfast -global_quality 28 -look_ahead 0 -pix_fmt nv12`
  - `libx264`: normal software path `-preset veryfast -crf 28`; weak profile `-preset ultrafast -crf 30`
- Apply the weak-machine filter only on encode:
  - `scale=854:480:force_original_aspect_ratio=decrease:flags=fast_bilinear`
  - keep original frame rate and timestamps
  - reduce preview audio bitrate from `128k` to `96k`
  - keep AAC and `+faststart`
- If the chosen hardware encoder fails on the real file, retry the next candidate before falling back to `libx264`.
- Keep annotator-facing result types unchanged. If needed for tests, extend preview dependencies with small hooks for encoder-plan resolution/probing only.
- Version the preview cache key with a new pipeline version plus output profile (`normal` vs `weak-480p`) so old previews do not mask the new behavior.

## Test Plan

- Add unit coverage for:
  - encoder priority `NVENC > AMF > QSV > libx264`
  - dedicated-GPU preference when both NVENC and QSV are usable
  - weak-machine activation when software-only or `<= 4` logical cores
  - no weak profile when hardware encoding is available on a stronger machine
  - hardware encode failure cascading to the next candidate, then to `libx264`
  - cache-key changes when pipeline version/profile changes
- Keep integration tests deterministic:
  - remux path unchanged
  - software encode path still produces a playable MP4
  - hardware probe behavior mocked rather than depending on CI hardware
- Add a probe helper test that locks the sample size at `128x72`, since smaller frames cause false negatives on NVENC/QSV.

## Assumptions

- This pass changes preview generation only; export/processor encoding stays as-is.
- Control is fully automatic in this version: no UI, CLI flag, or env override.
- “Weak machine” means software-only preview encoding or `<= 4` logical CPU cores.
- FFmpeg capability probes are the source of truth; Windows GPU inventory APIs are not required for correct behavior.
