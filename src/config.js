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

  // ---- Scoring (see DESIGN.md: why delay must cost points) ----
  // Every second past the dwell costs a point, on top of adding delay. Without
  // this, waiting was free until the 60 s cliff, so the best play was always to
  // spend it all. At 1 s per point, bot play (DESIGN.md section 4) shows waiting
  // for the last runners and leaving on time score within ~2% of each other: the
  // right call depends on who is running (wait for a VIP, not for a suitcase 6 s out).
  latePenaltySecondsPerPoint: 1,
  // Leaving before the dwell timer hits 0 earns this. Gives "go now" a reward too.
  onTimeBonusPoints: 3,
  // Boarding straight off a run (never stuck at a shut door) is worth this much more
  // than boarding after waiting. Makes opening doors AS people arrive the skill,
  // instead of keeping everything shut and opening all four at the end.
  happyBonusPoints: 1,
  // Waiting at a shut door longer than this makes a passenger grumpy (loses the
  // bonus). Short, but long enough to forgive a door opened a beat late.
  grumpyAfterWaitingSeconds: 0.6,
  // A door you open that closes again with nobody boarding costs this. Without it,
  // hammering every door (they reopen 0.5 s after closing) keeps them open nearly
  // all the time and beats timing them. With it, opening is a bet on who arrives.
  emptyDoorCyclePenaltyPoints: 1,
  // Boarding while the door is already closing: a last-second squeeze, rewarded.
  justMadeItBonusPoints: 1,
  // Stars on the shift-complete screen (AC 22): score as a fraction of a perfect
  // shift (everyone boarded happy, always on time). In bot play, door-mashing lands
  // around 0.5, keep-shut-then-open-all ~0.4, and near-perfect timing ~0.85, so
  // 2 stars needs real door timing and 3 needs nearly bot-perfect play.
  starScoreFractions: [0, 0.6, 0.8],

  // ---- Difficulty ramp (spec: "Difficulty over the shift") ----
  // Tuned harder than the spec's starting numbers (8 passengers / 15 s, then +3 and
  // -1 s per station, minimum 8 s), but every station stays within the +-20% that
  // AC 15 allows: about 15% more people and 13% less dwell throughout. Station 1
  // is 9 people in 13 s; station 8 is 34 people in 7.4 s. Passenger counts are
  // rounded, so the half-person step alternates +3 and +4.
  difficulty: {
    firstStationPassengers: 9,
    passengersAddedPerStation: 3.5,
    firstStationDwellSeconds: 13,
    dwellSecondsRemovedPerStation: 0.8,
    minimumDwellSeconds: 7,
  },

  // ---- Passengers ----
  // Commuter speed; every other type is a multiple of it (see PASSENGER_TYPES).
  // At 100 px/s a commuter needs ~2.5-4.5 s to get from the stairs to a door, so
  // anyone who appears in the last few seconds of dwell is a real "do I wait?" call.
  // (Was 110; slower runners make waiting for them cost more delay.)
  commuterRunSpeed: 100,

  // Pause before the first passenger appears, so the player sees the station
  // before anything moves.
  firstSpawnDelaySeconds: 0.6,

  // Passengers spawn spread evenly (with jitter) over this fraction of the dwell
  // time. Below 1 so the last person still appears before the timer hits 0, but
  // high enough that the last few are always still running when it does: every
  // station ends with a "wait for them, or go?" call. (Was 0.85.)
  spawnWindowFractionOfDwell: 0.95,

  // ---- Phone Guy (AC 18) ----
  // Chance per second of running that he stops to check his phone. A run from the
  // stairs takes ~2.5-4.5 s, so 0.6/s means most Phone Guys stop once or twice per
  // run: a real nuisance, but he still always arrives. (Was 0.4.)
  phoneStopChancePerSecond: 0.6,
  // Spec: each stop lasts 1-2 s.
  phoneStopMinSeconds: 1,
  phoneStopMaxSeconds: 2,
  // Before stopping he slows and raises his phone for this long: a warning you
  // can react to, so his stops are readable rather than pure bad luck.
  phoneWindupSeconds: 0.6,
  phoneWindupSpeedFraction: 0.35,

  // Passengers head for the door nearest their stairwell, give or take this much
  // (so the middle stairwell splits between doors 2 and 3). Was a random door,
  // which sent people running past three nearer ones.
  doorChoiceWobblePixels: 150,

  // ---- Doors ----
  // Spec: doors take ~0.5 s to close. Long enough to see the animation and for a
  // last-second runner to squeeze in, short enough that closing isn't a chore.
  doorCloseSeconds: 0.5,
  // A door only stays open this long, then closes by itself. Shorter than one
  // commuter's run from the stairs, so opening a door early wastes it: you have to
  // time it. (Was 3.)
  doorOpenSeconds: 2.5,
  // After a door finishes closing it can't be reopened for this long: just enough
  // to stop a door being held open by hammering its key. (Was 2.5; a long lockout
  // stranded ~29% of passengers even with perfect play. See DESIGN.md.)
  doorCooldownSeconds: 0.5,
  // Passengers step through a door one at a time, this long each, so a crowd at
  // one door takes a while to load: another reason not to leave it to the end.
  // A door's auto-close timer pauses while someone is in the doorway (like real
  // door sensors).
  boardingSecondsPerPassenger: 0.35,

  // ---- Door Blocker (AC 17) ----
  // Spec: a door that starts closing with a Blocker "within about one door-width"
  // pops back open. Measured from the Blocker's feet to the middle of the door's
  // platform edge; 80 px is a bit over one door width (68), so a Blocker who is
  // clearly heading into that doorway counts but one at the next door doesn't.
  blockerReachPixels: 80,
  // Spec: after a Blocker forces a door, it ignores its key for 2 s.
  blockerDoorLockSeconds: 2,

  // ---- Intro shot (3D renderer only; the 2D fallback goes straight to arriving) ----
  // One continuous shot before station 1: the driver's view down the tunnel, then
  // the camera flies out ahead of the train into the station and swings round to
  // the gameplay view while the train brakes in. Timeline: src/intro.js. Camera
  // path: GL_INTRO in src/render/webgl.js. Enter skips it.
  intro: {
    seconds: 10, // the whole shot; the train stops exactly at the end
    // The intro clock waits this long first: about the time the UI's transition
    // doors take to close over the title (ui.js UI_TIMING), so the shot starts as
    // they open instead of moving unseen behind them.
    holdSeconds: 0.47,
    // ~18 m/s in the 3D world (56.25 px per meter): fast enough that the tunnel
    // lights stream past, slow enough to read the cab.
    cruiseSpeed: 1012,
    // Cruise until here, then brake. Late in the shot, so the train is still
    // moving fast when it bursts out of the tunnel into the side view.
    brakeStartSeconds: 5.6,
  },

  // ---- Arrival / departure animation (purely visual; no rules run during them) ----
  // Long enough to read as a train gliding in or out, short enough that eight
  // stations of it never feels like waiting. The dwell timer starts only after
  // arrival, so these never cost the player delay.
  trainArriveSeconds: 1.4,
  trainDepartSeconds: 1.6,
  // How far (in layout pixels) the train travels to get fully off screen.
  trainTravelPixels: 1100,
  // How long a boarding passenger stays visible hopping through the doors.
  boardingAnimationSeconds: 0.35,

  // ---- Flash messages ----
  // How long short warnings like "Close all doors first!" stay on screen: long
  // enough to read 4-5 words mid-panic, short enough not to cover the platform.
  flashMessageSeconds: 1.5,
  // How long a station announcement ("Stand clear of the closing doors!") stays
  // up. A bit longer than flash warnings since announcements are longer sentences;
  // a newer announcement replaces the current one immediately.
  announcementSeconds: 2.2,

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
