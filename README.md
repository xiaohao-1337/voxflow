# VoxFlow

VoxFlow is a Chrome/Edge extension for local-first real-time web video voice translation.

Current milestone:

- Reorganized the project around the final architecture in `ARCHITECTURE.md`.
- Prioritized the Chrome extension side.
- Implemented an audio-capture test path: content script captures `<video>` audio via Web Audio, sends PCM frames to an offscreen document, and reports capture stats in the popup.
- Local FunASR/translation/TTS service directories are placeholders only.

## Development

```bash
npm install
npm run dev
```

Open a page with a normal non-DRM `<video>`, click the VoxFlow toolbar icon, and press Start. The popup should show increasing audio chunk counts, byte counts, RMS, and peak values.

## Build

```bash
npm run compile
npm run build
```

## Test Web

```shell
https://www.bilibili.com/video/BV1tGdbBAE21/?spm_id_from=333.337.search-card.all.click
```

