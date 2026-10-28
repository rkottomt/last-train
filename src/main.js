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
  round: null, // the current StationRound (kept after departure so screens can draw over it)
  lastStationResult: null, // what StationRound.finish() returned, for the summary screen
  flashMessage: null, // { text, secondsLeft } for short warnings like "Close all doors first!"
  announcement: null, // { text, secondsLeft } for station announcements (AC 19)
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
  game.flashMessage = null;
  game.announcement = null;
  changeState('station');
}

function isLastStation() {
  return game.stationIndex === STATIONS.length - 1;
}

// Total delay including the station we're at right now.
function currentTotalDelaySeconds() {
  return game.shift.totalDelaySeconds + game.round.delayAddedSeconds();
}

// Closes out the current station and folds its numbers into the shift totals.
function finishCurrentStation() {
  const result = game.round.finish();
  game.shift.score += result.netPoints;
  game.shift.totalDelaySeconds += result.delayAddedSeconds;
  game.shift.boardedCount += result.boardedCount;
  game.shift.leftBehindCount += result.leftBehindCount;
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
      if (action.type === 'toggleDoor') {
        game.round.toggleDoor(action.doorIndex);
      } else if (action.type === 'depart') {
        // AC 7: Space does nothing but warn unless every door is fully closed.
        if (!game.round.canDepart()) {
          showFlashMessage('Close all doors first!');
          return;
        }
        finishCurrentStation();
        changeState('summary');
      }
      // TODO(AC 23): 'pause' action. Toggle a game.isPaused flag here, skip
      // update() below while it's set (that stops every timer, since all timers
      // advance by dt), and draw "PAUSED" in draw().
    },
    update(dt) {
      game.round.update(dt);
      game.flashMessage = tickTimedMessage(game.flashMessage, dt);
      game.announcement = tickTimedMessage(game.announcement, dt);
      // Newest announcement wins; the round queues them, we only show one at a time.
      for (const text of game.round.drainAnnouncements()) {
        game.announcement = { text, secondsLeft: CONFIG.announcementSeconds };
      }
      // AC 12: the delay limit ends the shift the moment it's reached, even mid-station.
      if (currentTotalDelaySeconds() >= CONFIG.delayLimitSeconds) {
        finishCurrentStation();
        changeState('gameover');
      }
    },
    draw(ctx) {
      const round = game.round;
      round.draw(ctx);
      drawHud(ctx, {
        stationNumber: round.station.number,
        stationCount: STATIONS.length,
        stationName: round.station.name,
        dwellSecondsLeft: round.dwellSecondsLeft(),
        totalDelaySeconds: currentTotalDelaySeconds(),
        delayLimitSeconds: CONFIG.delayLimitSeconds,
        score: game.shift.score + round.pointsEarned,
      });
      if (game.announcement) drawAnnouncement(ctx, game.announcement.text);
      if (game.flashMessage) drawFlashMessage(ctx, game.flashMessage.text);
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
    update() {},
    draw(ctx) {
      game.round.draw(ctx); // the frozen platform shows through the overlay
      drawSummaryScreen(ctx, game.lastStationResult, game.shift, isLastStation());
    },
  },

  gameover: {
    onAction(action) {
      if (action.type === 'confirm') startShift();
    },
    update() {},
    draw(ctx) {
      drawGameOverScreen(ctx, game.shift, game.round.station.number);
    },
  },

  shiftcomplete: {
    onAction(action) {
      if (action.type === 'confirm') startShift();
    },
    update() {},
    draw(ctx) {
      drawShiftCompleteScreen(ctx, game.shift);
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
