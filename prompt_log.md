# Prompt log

## Model and tools

- **Tool:** Claude Code (CLI)
- **Model:** Claude Opus 5.5 (`claude-opus-5-5`)
- **Subagents** (Claude Code's Agent tool) were used for:
  - research on WebGPU rendering technique, and on art direction and UI
  - building the HTML/CSS UI (`src/ui.js`, `src/ui.css`)
  - a 3D renderer, attempted twice (WebGPU, then WebGL). Both were stopped before any of that code landed in the repo.
- **Testing:** headless Chrome and Brave, driven over the DevTools protocol from a scratch script outside the repo.

## Prompts (verbatim)

<!-- Paste the prompts here, in order. -->
