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
  // (The shift length, 8 stations, is the length of STATION_NAMES in station.js.)
  delayLimitSeconds: 60, // Spec: total delay of 60 s ends the game (AC 12).

  // ---- Difficulty ramp (spec: "Difficulty over the shift") ----
  // Station 1 has 8 passengers and 15 s dwell; each later station adds 3 passengers
  // and loses 1 s of dwell, never below 8 s. Station 8 ends up with 29 passengers
  // in 8 s, which is meant to be impossible to board fully.
  difficulty: {
    firstStationPassengers: 8,
    passengersAddedPerStation: 3,
    firstStationDwellSeconds: 15,
    dwellSecondsRemovedPerStation: 1,
    minimumDwellSeconds: 8,
  },

  // ---- Passengers ----
  // Commuter speed; every other type is a multiple of it (see PASSENGER_TYPES).
  // At 110 px/s a commuter needs ~2-4 s to get from the stairs to a door, so
  // anyone who appears in the last few seconds of dwell is a real "do I wait?" call.
  commuterRunSpeed: 110,

  // Pause before the first passenger appears, so the player sees the station
  // before anything moves.
  firstSpawnDelaySeconds: 0.6,

  // Passengers spawn spread evenly (with jitter) over this fraction of the dwell
  // time. Below 1 so most people can make an on-time train, but high enough that
  // the last few are always still running when the timer hits 0.
  spawnWindowFractionOfDwell: 0.85,

  // ---- Phone Guy (AC 18) ----
  // Chance per second of running that he stops to check his phone. A run from the
  // stairs takes ~2-4 s, so 0.4/s means most Phone Guys stop about once per run:
  // often enough to notice, not so often that he never arrives.
  phoneStopChancePerSecond: 0.4,
  // Spec: each stop lasts 1-2 s.
  phoneStopMinSeconds: 1,
  phoneStopMaxSeconds: 2,

  // ---- Doors ----
  // Spec: doors take ~0.5 s to close. Long enough to see the animation and for a
  // last-second runner to squeeze in, short enough that closing isn't a chore.
  doorCloseSeconds: 0.5,

  // ---- Door Blocker (AC 17) ----
  // Spec: a door that starts closing with a Blocker "within about one door-width"
  // pops back open. Measured from the Blocker's feet to the middle of the door's
  // platform edge; 80 px is a bit over one door width (68), so a Blocker who is
  // clearly heading into that doorway counts but one at the next door doesn't.
  blockerReachPixels: 80,
  // Spec: after a Blocker forces a door, it ignores its key for 2 s.
  blockerDoorLockSeconds: 2,

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
    // People queue in a band this deep in front of their door. Deep enough that a
    // crowd fans out instead of stacking into one sprite.
    waitingAreaDepth: 50,
    // Stairwells along the back (bottom) of the platform, where passengers appear.
    // Three, spread out, so some people have a long diagonal run to their door.
    stairwellCenterXs: [170, 480, 790],
    stairwellWidth: 96,
    stairwellTop: 488,
  },
};
