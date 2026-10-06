# Noteable — Project 109

Personal audiobook and study-guide maker. Installable PWA on GitHub Pages, Kokoro TTS running on-device, all data in a `Noteable/` folder in Rob's Google Drive.

## Source of truth

- `docs/SPEC.md` is the full spec. Everything under "Locked decisions" is final; don't re-open it without asking Rob.
- Phase documents go in `docs/phases/phase-N.md`, one per build phase in the spec.

## How to work

- Before writing code for a phase, write its phase document: concrete steps plus the spec's "Done when" gate.
- Flag anything ambiguous or technically risky and ask Rob instead of guessing.
- Build one phase at a time. Stop when the phase gate is ready for Rob to test on his S23 Ultra.
- The app never calls Google Drive directly; everything goes through the `Storage` adapter so a Railway backend can replace Drive later.

## Environment

- Rob develops on Windows (desktop: Ryzen 9 9800X3D, RX 9070 XT). The desktop queue worker targets Windows.
- Test devices: Samsung S23 Ultra (Chrome, WebGPU confirmed), iPhone, HP OmniBook laptop.
- Measured Kokoro speed on the S23 Ultra: about 1.1× real time on WebGPU fp32.
