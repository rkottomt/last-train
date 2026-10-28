// Entry point: the game loop and the top-level state machine.
//
// The game is always in exactly one state (title, station, summary, gameover,
// shiftcomplete). Each state is an entry in GAME_STATES with three hooks:
//   onAction(action) - handle one input action (see input.js)
//   update(dt)       - advance the simulation by dt seconds
//   draw(ctx)        - draw the whole frame
// Adding a screen means adding an entry here and calling changeState() to get there.

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

// Running totals for the whole shift (8 stations). The current station's numbers
// live on game.round until departure, then get folded in here.
function newShiftTotals() {
  return {
    score: 0,
    totalDelaySeconds: 0,
    boardedCount: 0,
    leftBehindCount: 0,
  };
}

const game = {
  state: 'title',
  stationIndex: 0, // index into STATIONS
  shift: newShiftTotals(),
  round: null, // the current StationRound while state === 'station'
};

function changeState(nextState) {
  game.state = nextState;
}

function startShift() {
  game.stationIndex = 0;
  game.shift = newShiftTotals();
  startStation();
}

function startStation() {
  game.round = new StationRound(STATIONS[game.stationIndex]);
  changeState('station');
}

const GAME_STATES = {
  title: {
    onAction(action) {
      if (action.type === 'confirm') startShift();
    },
    update() {},
    draw(ctx) {
      drawTitleScreen(ctx);
    },
  },

  station: {
    onAction(action) {
      if (action.type === 'toggleDoor') game.round.toggleDoor(action.doorIndex);
    },
    update(dt) {
      game.round.update(dt);
    },
    draw(ctx) {
      game.round.draw(ctx);
      const round = game.round;
      drawHud(ctx, {
        stationNumber: round.station.number,
        stationCount: STATIONS.length,
        stationName: round.station.name,
        dwellSecondsLeft: round.dwellSecondsLeft(),
        totalDelaySeconds: game.shift.totalDelaySeconds,
        delayLimitSeconds: CONFIG.delayLimitSeconds,
        score: game.shift.score + round.pointsEarned,
      });
    },
  },
};

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
    GAME_STATES[game.state].onAction(action);
  }
  GAME_STATES[game.state].update(dt);
  GAME_STATES[game.state].draw(ctx);

  requestAnimationFrame(frame);
}

Input.init();
requestAnimationFrame(frame);
