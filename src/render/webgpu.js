// WebGPU world renderer (placeholder). Implements the renderer interface
// documented at the top of src/render/canvas2d.js. Until it's built, init()
// reports "unsupported" and main.js falls back to Canvas 2D.

const WebGPURenderer = {
  name: 'WebGPU',

  async init() {
    return false;
  },

  render() {},
};
