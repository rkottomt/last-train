// Every tunable number in the game lives here, so balancing never means hunting
// through logic files. Units: seconds for time, pixels for distance, pixels per
// second for speed. The spec says all of these are starting points; if you change
// one after playtesting, note it in the README.

const CONFIG = {
  // ---- Canvas ----
  // 16:9 at a size that fits a laptop browser without scrolling. index.html scales
  // the canvas with CSS, so game code can always assume these exact dimensions.
  canvasWidth: 960,
  canvasHeight: 540,

  // Longest frame we simulate in one step. If the tab is hidden and comes back,
  // requestAnimationFrame reports a huge gap; without this cap, passengers would
  // teleport and the delay timer would jump by the whole time the tab was hidden.
  maxFrameSeconds: 0.1,

  // ---- Shift rules ----
  stationsPerShift: 8, // Spec: "A shift is 8 stations."
  delayLimitSeconds: 60, // Spec: total delay of 60 s ends the game (AC 12).

  // ---- Doors ----
  // Spec: doors take ~0.5 s to close. Long enough to see the animation and for a
  // last-second runner to squeeze in, short enough that closing isn't a chore.
  doorCloseSeconds: 0.5,

  // ---- Flash messages ----
  // How long short warnings like "Close all doors first!" stay on screen: long
  // enough to read 4-5 words mid-panic, short enough not to cover the platform.
  flashMessageSeconds: 1.5,

  // ---- Layout (pixel positions on the 960x540 canvas) ----
  layout: {
    hudHeight: 48,
    // The train sits across the middle of the screen (spec: "Layout").
    trainLeft: 30,
    trainRight: 930,
    trainTop: 96,
    trainBottom: 250,
    doorWidth: 68,
    doorHeight: 126,
    // The platform starts just under the train; the small gap is the platform edge.
    platformTop: 258,
  },
};
