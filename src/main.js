// Entry point: picks a renderer, runs the game loop and the top-level state machine.
//
// Three layers, each only talking to the next through one plain object:
//   game logic (this file + round/train/passenger/station.js)
//     -> view    -> a world renderer (src/render/webgl.js, or canvas2d.js as fallback)
//     -> uiState -> the UI layer (src/ui.js)
// Renderers and the UI only read; all rules live in the logic files.
//
// The game is always in exactly one state. Each state is an entry in GAME_STATES
// with two hooks:
//   onAction(action) - handle one input action (see input.js)
//   update(dt)       - advance the simulation by dt seconds
// Adding a screen means adding an entry here, a case in buildUiState(), and
// calling changeState() to get there.
//
//   title -> arriving -> station -> departing -> summary -> arriving -> ... (8 stations)
//     |                    ^  |                       '-> shiftcomplete (after station 8)
//     '-> intro (3D only) -'  '-> gameover (delay limit hit)

// Running totals for the whole shift (8 stations). The current station's numbers
// live on game.round until departure, then get folded in here.
function newShiftTotals() {
  return {
    score: 0,
    totalDelaySeconds: 0,
    boardedCount: 0,
    leftBehindCount: 0,
    perfectScore: 0, // sum of each finished station's best possible score (for stars)
  };
}

const game = {
  state: 'title',
  stationIndex: 0, // index into STATIONS
  shift: newShiftTotals(),
  round: null, // the current StationRound (kept after departure so the world stays drawn)
  lastStationResult: null, // what StationRound.finish() returned, for the summary screen
  flashMessage: null, // { text, secondsLeft } for short warnings like "Close all doors first!"
  announcement: null, // { text, secondsLeft } for station announcements (AC 19)
  stateSeconds: 0, // time spent in the current state (drives arrive / depart animations)
  clockSeconds: 0, // never resets; ambient animation for renderers
};

// The world renderer in use (WebGLRenderer or Canvas2DRenderer), chosen at startup.
let worldRenderer = null;
// A parked, empty train for the title screen, which has no round yet.
const titleScreenTrain = new Train();

function changeState(nextState) {
  game.state = nextState;
  game.stateSeconds = 0;
}

// withIntro: only a shift started from the title plays the intro shot (3D only);
// a restart should get you back into play fast.
function startShift({ withIntro = false } = {}) {
  game.stationIndex = 0;
  game.shift = newShiftTotals();
  startStation();
  if (withIntro && worldRenderer.hasIntroShot) changeState('intro');
}

// 1-3 stars for a finished shift (AC 22): the score as a fraction of a perfect
// shift, against CONFIG.starScoreFractions. A shift that ended in game over gets none.
function shiftStars() {
  if (game.state !== 'shiftcomplete' || game.shift.perfectScore <= 0) return 0;
  const fraction = game.shift.score / game.shift.perfectScore;
  return CONFIG.starScoreFractions.filter((threshold) => fraction >= threshold).length;
}

function startStation() {
  game.round = new StationRound(STATIONS[game.stationIndex]);
  game.flashMessage = null;
  game.announcement = null;
  changeState('arriving');
}

function isLastStation() {
  return game.stationIndex === STATIONS.length - 1;
}

// Total delay including the station we're at right now.
function currentTotalDelaySeconds() {
  const roundDelay = game.state === 'station' ? game.round.delayAddedSeconds() : 0;
  return game.shift.totalDelaySeconds + roundDelay;
}

// Closes out the current station and folds its numbers into the shift totals.
function finishCurrentStation() {
  const result = game.round.finish();
  game.shift.score += result.netPoints;
  game.shift.totalDelaySeconds += result.delayAddedSeconds;
  game.shift.boardedCount += result.boardedCount;
  game.shift.leftBehindCount += result.leftBehindCount;
  game.shift.perfectScore += result.perfectPoints;
  game.lastStationResult = result;
}

function showFlashMessage(text) {
  game.flashMessage = { text, secondsLeft: CONFIG.flashMessageSeconds };
}

// Counts a { text, secondsLeft } message down; returns null once it has expired.
function tickTimedMessage(message, dt) {
  if (!message) return null;
  message.secondsLeft -= dt;
  return message.secondsLeft > 0 ? message : null;
}

// Seconds into the intro shot. Holds at 0 while the UI's doors close over the title.
function introClockSeconds() {
  return Math.max(0, game.stateSeconds - CONFIG.intro.holdSeconds);
}

function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

function easeInCubic(t) {
  return t * t * t;
}

const GAME_STATES = {
  title: {
    onAction(action) {
      if (action.type === 'confirm') startShift({ withIntro: true });
    },
    update() {},
  },

  // Visual only: the opening shot (CONFIG.intro), which ends with the train docked,
  // so it goes straight to 'station'. No rules run and the dwell timer hasn't
  // started. Enter skips it.
  intro: {
    onAction(action) {
      if (action.type === 'confirm') changeState('station');
    },
    update() {
      if (introClockSeconds() >= CONFIG.intro.seconds) changeState('station');
    },
  },

  // Visual only: the train glides in. No rules run, and the dwell timer hasn't
  // started (spec: the timer starts once the train has pulled in).
  arriving: {
    onAction() {},
    update() {
      if (game.stateSeconds >= CONFIG.trainArriveSeconds) changeState('station');
    },
  },

  station: {
    onAction(action) {
      if (action.type === 'toggleDoor') {
        const door = game.round.train.doors[action.doorIndex];
        if (!game.round.toggleDoor(action.doorIndex) && door.isCoolingDown()) {
          showFlashMessage(`Door ${door.label} recharging: ${door.cooldownSecondsLeft.toFixed(1)}s`);
        }
      } else if (action.type === 'depart') {
        // AC 7: Space does nothing but warn unless every door is fully closed.
        if (!game.round.canDepart()) {
          showFlashMessage('Close all doors first!');
          return;
        }
        finishCurrentStation();
        game.round.announce(`Next stop: ${isLastStation() ? 'the depot' : STATIONS[game.stationIndex + 1].name}`);
        changeState('departing');
      }
      // TODO(AC 23): 'pause' action. Toggle a game.isPaused flag here, skip
      // update() in frame() while it's set (that stops every timer, since all
      // timers advance by dt), and add an isPaused flag to uiState.
    },
    update(dt) {
      game.round.update(dt);
      // AC 12: the delay limit ends the shift the moment it's reached, even mid-station.
      if (currentTotalDelaySeconds() >= CONFIG.delayLimitSeconds) {
        finishCurrentStation();
        changeState('gameover');
      }
    },
  },

  // Visual only: the train pulls out while the people left behind slump (AC 20).
  departing: {
    onAction() {},
    update(dt) {
      game.round.updateAnimationsOnly(dt);
      if (game.stateSeconds >= CONFIG.trainDepartSeconds) changeState('summary');
    },
  },

  summary: {
    onAction(action) {
      if (action.type !== 'confirm') return;
      if (isLastStation()) {
        changeState('shiftcomplete');
      } else {
        game.stationIndex += 1;
        startStation();
      }
    },
    update(dt) {
      game.round.updateAnimationsOnly(dt);
    },
  },

  gameover: {
    onAction(action) {
      if (action.type === 'confirm') startShift();
    },
    update() {},
  },

  shiftcomplete: {
    onAction(action) {
      if (action.type === 'confirm') startShift();
    },
    update() {},
  },
};

// Where the train is drawn, in layout pixels: off to the right while arriving,
// docked during the station, sliding off to the left once it departs.
function trainOffsetPixels() {
  const travel = CONFIG.trainTravelPixels;
  switch (game.state) {
    case 'title':
      return travel; // parked off screen; it arrives when the shift starts
    case 'intro':
      return IntroTimeline.trainOffsetPixels(introClockSeconds());
    case 'arriving':
      return travel * (1 - easeOutCubic(Math.min(1, game.stateSeconds / CONFIG.trainArriveSeconds)));
    case 'departing':
      return -travel * easeInCubic(Math.min(1, game.stateSeconds / CONFIG.trainDepartSeconds));
    case 'summary':
    case 'shiftcomplete':
      return -travel;
    default:
      return 0;
  }
}

// Everything a world renderer needs for one frame (contract: src/render/canvas2d.js).
function buildView() {
  const round = game.round;
  return {
    screen: game.state,
    stationName: round ? round.station.name : '',
    train: round ? round.train : titleScreenTrain,
    passengers: round && game.state !== 'title' ? round.passengers : [],
    trainOffsetPixels: trainOffsetPixels(),
    timeSeconds: game.clockSeconds,
    // Only during the intro: lets the 3D renderer fly its camera (null otherwise).
    intro: game.state === 'intro'
      ? {
        seconds: introClockSeconds(),
        durationSeconds: CONFIG.intro.seconds,
        speedFraction: IntroTimeline.speedFraction(introClockSeconds()),
      }
      : null,
  };
}

// Everything the UI needs for one frame (contract: top of src/ui.js).
function buildUiState() {
  const round = game.round;
  const showHud = round && game.state !== 'title';
  return {
    screen: game.state,
    rendererName: worldRenderer.name,
    stationCount: STATIONS.length,
    hud: showHud
      ? {
        stationNumber: round.station.number,
        stationName: round.station.name,
        dwellSecondsLeft: round.dwellSecondsLeft(),
        totalDelaySeconds: currentTotalDelaySeconds(),
        delayLimitSeconds: CONFIG.delayLimitSeconds,
        score: game.state === 'station' ? game.shift.score + round.livePoints() : game.shift.score,
        stillComingCount: round.spawnSchedule.length - round.nextSpawnIndex,
      }
      : null,
    doors: showHud
      ? round.train.doors.map((door) => ({
        label: door.label,
        state: door.state,
        isLocked: door.isLocked(),
        lockedSecondsLeft: door.lockedSecondsLeft,
      }))
      : null,
    flashMessage: game.flashMessage ? game.flashMessage.text : null,
    announcement: game.announcement ? game.announcement.text : null,
    lastStationResult: game.lastStationResult,
    shift: game.shift,
    isLastStation: isLastStation(),
    endStationNumber: round ? round.station.number : null,
    stars: shiftStars(),
    scoring: {
      latePenaltySecondsPerPoint: CONFIG.latePenaltySecondsPerPoint,
      onTimeBonusPoints: CONFIG.onTimeBonusPoints,
    },
    intro: game.state === 'intro' ? { seconds: introClockSeconds(), durationSeconds: CONFIG.intro.seconds } : null,
  };
}

// ---- Game loop ----

let previousTimestamp = null;

function frame(timestamp) {
  // dt is seconds since the last frame, capped so a backgrounded tab can't cause a
  // huge simulation jump when it comes back (see CONFIG.maxFrameSeconds).
  const dt = previousTimestamp === null ? 0 : Math.min((timestamp - previousTimestamp) / 1000, CONFIG.maxFrameSeconds);
  previousTimestamp = timestamp;

  // Actions are routed to whichever state is current when each one is handled, so
  // an Enter that changes state isn't also handled by the new state.
  for (const action of Input.drainActions()) {
    // R restarts the shift from anywhere once one has started (no intro).
    if (action.type === 'restart') {
      if (game.state !== 'title') startShift();
      continue;
    }
    GAME_STATES[game.state].onAction(action);
  }
  game.stateSeconds += dt;
  game.clockSeconds += dt;
  GAME_STATES[game.state].update(dt);

  game.flashMessage = tickTimedMessage(game.flashMessage, dt);
  game.announcement = tickTimedMessage(game.announcement, dt);
  if (game.round) {
    // Newest announcement wins; the round queues them, we only show one at a time.
    for (const text of game.round.drainAnnouncements()) {
      game.announcement = { text, secondsLeft: CONFIG.announcementSeconds };
    }
  }

  // If the 3D context is lost mid-game (GPU reset, driver crash), drop to 2D
  // instead of freezing. A lost renderer's render() is a no-op until then.
  if (worldRenderer.isLost && worldRenderer.isLost() && !isSwitchingRenderer) {
    isSwitchingRenderer = true;
    switchToCanvas2D().then((fallbackRenderer) => {
      worldRenderer = fallbackRenderer;
      isSwitchingRenderer = false;
    });
  }

  worldRenderer.render(buildView());
  UI.render(buildUiState());
  requestAnimationFrame(frame);
}

let isSwitchingRenderer = false;

// Try WebGL2 (3D) first; fall back to Canvas 2D silently (AC 1: no console errors).
// WebGL2 rather than WebGPU because it runs by default in every current browser,
// including Brave, Firefox and Safari.
async function chooseWorldRenderer() {
  const worldCanvas = document.getElementById('world');
  if (await WebGLRenderer.init(worldCanvas)) return WebGLRenderer;
  return switchToCanvas2D();
}

// A canvas that has handed out one kind of context can never give another, so the
// 2D renderer always gets a fresh canvas element in the same spot.
async function switchToCanvas2D() {
  const oldCanvas = document.getElementById('world');
  const freshCanvas = oldCanvas.cloneNode(false);
  oldCanvas.replaceWith(freshCanvas);
  await Canvas2DRenderer.init(freshCanvas);
  return Canvas2DRenderer;
}

async function startGame() {
  Input.init();
  UI.init(document.getElementById('ui'));
  worldRenderer = await chooseWorldRenderer();
  requestAnimationFrame(frame);
}

startGame();
