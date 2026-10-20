# DiaScreen site

A Jekyll site for GitHub Pages: a homepage that presents the five screening modules, plus the
DiaScreen app itself at `/app/`.

## Where things live

| To change… | Edit |
|---|---|
| Site name, your name, email, URL | `_config.yml` |
| A module card (title, summary, inputs, outputs, guideline) | `_data/tools.yml` |
| Homepage wording and sections | `index.html` |
| Header, footer, `<head>` tags | `_layouts/base.html` |
| Look and feel | `assets/site.css` |
| Theme toggle and search | `assets/site.js` |
| The app (screening logic, forms, report) | `app/index.html` |

The cards, search and 404 page are generated from `_data/tools.yml`, so a module is written once.

## Publish

1. Settings, Pages, deploy from the `main` branch, `/ (root)`.
2. The site is a project page at `https://medinnnetworking-now.github.io/Sugarscreen/` (`url` and `baseurl` in `_config.yml`). If you move it to a `<username>.github.io` repo, set `baseurl: ""`.
3. Fill in `author` in `_config.yml`.

## Preview locally

```sh
bundle install
bundle exec jekyll serve   # http://localhost:4000
```

## Before real clinical use

The app has a hard-coded demo login (`clinician` / `screen2026`) that anyone can read in the page
source. It is not authentication. Patient records live only in the browser (`localStorage`), so do not
enter identifiable data on shared devices. A clinical deployment needs individual accounts,
encrypted storage, audit logs and regulatory approval.

## AI wound outline (beta)

In the foot module, after marking the size reference, choose **Or: AI outline (beta)** and tap inside the
wound. A Segment Anything model (MobileSAM, ONNX) runs in the browser, draws the edge, and the area is
calculated with the existing calibration. The photo never leaves the device.

- `assets/ai/wound-ai.js` loads the runtime and model, runs it, and turns the mask into an outline.
- `assets/vendor/ort/` is the ONNX Runtime Web build (Microsoft, MIT), self-hosted.
- The two model files are looked for at `models/mobile_sam_image_encoder.onnx` and
  `models/sam_mask_decoder_multi.onnx` in this repo, then fetched from Hugging Face (`Acly/MobileSAM`).
  The browser caches them after the first download.
- To use other model URLs, set `window.DIA_AI_MODELS = { encoder: [url], decoder: [url] }` before the module loads.

Status: the plumbing is tested with a stand-in model (area error under 1% on a synthetic wound). It has
**not** been tested with the real MobileSAM weights or on real wounds. Validate it against ruler or
planimetry measurements before relying on it, and always check the edge by eye.

