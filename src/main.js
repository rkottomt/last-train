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

const game = {
  state: 'title',
  round: null, // the current StationRound while state === 'station'
};

function changeState(nextState) {
  game.state = nextState;
}

function startStation() {
  game.round = new StationRound();
  changeState('station');
}

const GAME_STATES = {
  title: {
    onAction(action) {
      if (action.type === 'confirm') startStation();
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
      drawHud(ctx, {
        stationNumber: 1,
        stationCount: CONFIG.stationsPerShift,
        stationName: '???',
        dwellSecondsLeft: 15,
        totalDelaySeconds: 0,
        delayLimitSeconds: CONFIG.delayLimitSeconds,
        score: 0,
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
