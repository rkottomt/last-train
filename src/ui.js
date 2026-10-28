// The UI layer: everything that isn't the world itself. That's the HUD bar along
// the top, announcements, flash messages, and the title / summary / game-over /
// shift-complete screens. It sits on top of the world canvas and never changes
// game state.
//
// UI INTERFACE (main.js only talks to the UI through this):
//   UI.init(container)  - build the UI inside the #ui element
//   UI.render(uiState)  - called every frame; must be cheap when nothing changed
//
// uiState (built fresh by main.js every frame):
//   screen            - 'title' | 'intro' | 'arriving' | 'station' | 'departing' | 'summary' | 'gameover' | 'shiftcomplete'
//   rendererName      - 'WebGL' or 'Canvas 2D' (shown in a small badge)
//   stationCount      - 8
//   hud               - null on title, else { stationNumber, stationName, dwellSecondsLeft
//                       (negative = running late), totalDelaySeconds, delayLimitSeconds, score }
//                       (still filled in on summary / game over / shift complete: the
//                       end screens read stationName and delayLimitSeconds from it)
//   doors             - null on title, else [{ label, state ('open'|'closing'|'closed'),
//                       isLocked, lockedSecondsLeft }]
//   flashMessage      - string or null ("Close all doors first!")
//   announcement      - string or null ("Stand clear of the closing doors!")
//   lastStationResult - null, or what StationRound.finish() returned (summary screen)
//   shift             - { score, totalDelaySeconds, boardedCount, leftBehindCount }
//   isLastStation     - true while at / after station 8
//   endStationNumber  - station number where the shift ended (game over screen)
//   intro             - during the intro shot only: { seconds, durationSeconds }; else null
//
// HOW THIS VERSION WORKS
// It's plain HTML/CSS laid over the world canvas (styles: src/ui.css). init()
// builds all the markup once from UI_TEMPLATE and keeps every element tagged
// data-ui="someName" in UI.elements. render() then only writes values that changed
// since the last frame (setText / setClass / setData / setStyle remember what they
// last wrote), so a frame where nothing changed doesn't touch the DOM at all.
// Everything is sized in cqw/cqh (percent of the 16:9 #stage), so the UI scales
// with the window exactly like the world canvas does.
//
// Screens come in groups (SCREEN_GROUPS). The three gameplay states share one:
// the HUD over the live world. Title, summary, game over and shift complete are
// each a panel of their own. Changing group either plays the new panel's own
// entrance animation, or slides a pair of train doors shut over the screen,
// swaps the content while they're closed and slides them open again. See
// updateScreenTransition().

// ---- Tunables ----

// The door transition is timed here, not by CSS events, so the content swap
// happens exactly while the doors are shut. init() copies these into CSS
// variables so the slide animation and this timer can never disagree.
const UI_TIMING = {
  doorsCloseMs: 380,
  // Long enough (several frames) for the swapped-in screen to be fully drawn
  // before the doors start opening again.
  doorsHoldMs: 90,
  doorsOpenMs: 380,
  // How long the little "+5" next to the score stays up.
  scoreDeltaMs: 900,
};

// Captions over the intro shot, in intro-clock seconds (CONFIG.intro.seconds is
// the whole shot). The driver caption is up while the camera is in the cab; the
// station sign while the train pulls in; the letterbox bars slide away at the end
// so the HUD arrives on a full-height picture.
const INTRO_TIMING = {
  driverCaption: [0.5, 3.3],
  stationSign: [6.4, 9.2],
  letterboxRetract: [8.6, 9.9],
};

// Fraction of the delay limit at which the delay meter turns amber, then red.
// Red starts with ~12 s to spare at the default 60 s limit: enough warning to
// stop holding doors for stragglers.
const DELAY_METER_LEVELS = {
  warnFraction: 0.5,
  dangerFraction: 0.8,
};

// Which panel each game state shows. Moving between states in the same group
// (arriving -> station -> departing) never triggers a screen transition.
const SCREEN_GROUPS = {
  title: 'title',
  intro: 'intro',
  arriving: 'play',
  station: 'play',
  departing: 'play',
  summary: 'summary',
  gameover: 'gameover',
  shiftcomplete: 'shiftcomplete',
};

// The small label above the dwell countdown, per gameplay state.
const DWELL_LABELS = {
  arriving: 'Arriving',
  station: 'Dwell time',
  departing: 'Departed',
};

const MINUS_SIGN = '−'; // a real minus: same width as "+" in tabular numbers

// ---- Markup (built once by init) ----

// A row of figures on the game-over and shift-complete cards.
function shiftStatsTemplate() {
  return `
    <div class="report-stats">
      <div class="report-stat"><span class="report-stat-label">Boarded</span><span class="report-stat-value num" data-stat="boarded"></span></div>
      <div class="report-stat"><span class="report-stat-label">Left behind</span><span class="report-stat-value num" data-stat="leftBehind"></span></div>
      <div class="report-stat"><span class="report-stat-label">Total delay</span><span class="report-stat-value num" data-stat="totalDelay"></span></div>
      <div class="report-stat report-stat-score"><span class="report-stat-label">Final score</span><span class="report-stat-value num" data-stat="score"></span></div>
    </div>`;
}

const UI_TEMPLATE = `
  <section class="screen screen-play" data-ui="playScreen">
    <header class="hud">
      <div class="hud-bar">
        <div class="hud-block hud-station">
          <div class="hud-label">
            <span class="num" data-ui="hudStationNumber"></span>
            <span class="line-map" data-ui="hudLineMap"></span>
          </div>
          <div class="hud-station-name" data-ui="hudStationName"></div>
        </div>
        <div class="hud-block hud-dwell">
          <div class="hud-label" data-ui="dwellLabel"></div>
          <div class="led-panel" data-ui="dwellPanel">
            <span class="led-text led-dots num" data-ui="dwellValue"></span><span class="led-text led-dots led-suffix"> late</span>
          </div>
        </div>
        <div class="hud-block hud-doors">
          <div class="hud-label"><span>Doors</span><span class="hud-coming num" data-ui="comingValue"></span></div>
          <div class="door-lights" data-ui="doorLights"></div>
        </div>
        <div class="hud-block hud-depart" data-ui="departHint">
          <div class="hud-label">Depart</div>
          <span class="key key-hud">Space</span>
        </div>
        <div class="hud-block hud-delay" data-ui="delayBlock">
          <div class="hud-label"><span>Delay</span><span class="hud-delay-value num" data-ui="delayValue"></span></div>
          <div class="meter"><div class="meter-fill" data-ui="delayFill"></div></div>
        </div>
        <div class="hud-block hud-score">
          <div class="hud-label">Score</div>
          <div class="score">
            <span class="score-delta num" data-ui="scoreDelta"></span>
            <span class="score-value num" data-ui="scoreValue"></span>
          </div>
        </div>
      </div>
      <div class="pa" data-ui="pa" role="status" aria-live="polite">
        <span class="pa-icon" aria-hidden="true"><i></i></span>
        <span class="pa-text" data-ui="paText"></span>
      </div>
    </header>

    <div class="arrival" data-ui="arrival">
      <div class="sign arrival-sign">
        <span class="bullet num" data-ui="arrivalNumber"></span>
        <span class="arrival-name" data-ui="arrivalName"></span>
      </div>
      <div class="arrival-meta num" data-ui="arrivalMeta"></div>
    </div>

    <div class="flash" data-ui="flash" role="alert">
      <div class="flash-plate" data-ui="flashPlate">
        <span class="flash-icon" aria-hidden="true">!</span>
        <span data-ui="flashText"></span>
      </div>
    </div>
  </section>

  <section class="screen screen-intro" data-ui="introScreen">
    <div class="letterbox letterbox-top"></div>
    <div class="letterbox letterbox-bottom"></div>
    <div class="intro-caption" data-ui="introCaption">
      <div class="intro-kicker">Line 4 &middot; Last service tonight</div>
      <div class="intro-line">You're the driver.</div>
    </div>
    <div class="arrival" data-ui="introArrival">
      <div class="sign arrival-sign">
        <span class="bullet num" data-ui="introArrivalNumber"></span>
        <span class="arrival-name" data-ui="introArrivalName"></span>
      </div>
      <div class="arrival-meta num" data-ui="introArrivalMeta"></div>
    </div>
    <div class="intro-skip"><span class="key">Enter</span> Skip</div>
  </section>

  <section class="screen screen-title" data-ui="titleScreen">
    <div class="scrim"></div>
    <div class="title-card panel">
      <div class="sign title-sign">
        <span class="bullet bullet-moon" aria-hidden="true"><i></i></span>
        <h1 class="title-name">Last Train</h1>
      </div>
      <div class="title-body">
        <p class="title-kicker">Evening rush &middot; 8 stations &middot; 1 tired operator</p>
        <p class="title-tagline">Get them home. Stay on schedule. Pick one.</p>
        <div class="controls">
          <div class="control-row">
            <span class="control-keys"><span class="key">1</span><span class="key">2</span><span class="key">3</span><span class="key">4</span></span>
            <span class="control-meaning">Open that door (it shuts itself)</span>
          </div>
          <div class="control-row">
            <span class="control-keys"><span class="key key-wide">Space</span></span>
            <span class="control-meaning">Depart (all doors closed)</span>
          </div>
          <div class="control-row">
            <span class="control-keys"><span class="key key-wide">Enter</span></span>
            <span class="control-meaning">Start / next station</span>
          </div>
          <div class="control-row">
            <span class="control-keys"><span class="key">R</span></span>
            <span class="control-meaning">Restart the shift</span>
          </div>
        </div>
        <p class="title-rule">Open each door as its runners arrive: +2 each, +1 if you kept them waiting.
          A door opened for nobody costs 1. Every second late costs 1; leaving on time earns 3.
          Run 60&nbsp;s late in total and you're off the line.</p>
      </div>
    </div>
    <div class="ticker"><span class="ticker-arrow" aria-hidden="true"></span><span>Press Enter to start your shift</span></div>
  </section>

  <section class="screen screen-summary" data-ui="summaryScreen">
    <div class="board panel">
      <div class="board-header">
        <div class="sign board-sign">
          <span class="board-kicker">Departed</span>
          <span class="board-station" data-ui="summaryStationName"></span>
        </div>
        <div class="board-progress">
          <span class="num" data-ui="summaryStationNumber"></span>
          <span class="line-map" data-ui="summaryLineMap"></span>
        </div>
        <div class="board-log">
          <span class="board-log-label">Operator's log</span>
          <p class="board-remark" data-ui="summaryRemark"></p>
        </div>
      </div>
      <div class="board-rows">
        <div class="board-row" style="--row: 0">
          <span class="row-label">Boarded
            <span class="row-note" data-ui="summaryBoardedNote"></span>
          </span>
          <span class="row-value led-text num" data-ui="summaryBoarded"></span>
          <span class="row-extra row-points num" data-ui="summaryBoardedPoints"></span>
        </div>
        <div class="board-row" style="--row: 1">
          <span class="row-label">Left behind
            <span class="row-note" data-ui="summaryStairsNote"></span>
          </span>
          <span class="row-value led-text num" data-ui="summaryLeftBehind"></span>
          <span class="row-extra row-points num" data-ui="summaryPenaltyPoints"></span>
        </div>
        <div class="board-row" style="--row: 2">
          <span class="row-label">Delay added</span>
          <span class="row-value led-text num" data-ui="summaryDelayAdded"></span>
          <span class="row-extra"><span class="tag" data-ui="summaryDelayTag"></span></span>
        </div>
        <div class="board-row" style="--row: 3">
          <span class="row-label">Total delay</span>
          <span class="row-value led-text num" data-ui="summaryTotalDelay"></span>
          <span class="row-extra"><span class="meter meter-small" data-ui="summaryDelayMeter"><span class="meter-fill" data-ui="summaryDelayFill"></span></span></span>
        </div>
        <div class="board-row board-row-score" style="--row: 4">
          <span class="row-label">Score</span>
          <span class="row-value row-score num" data-ui="summaryScore"></span>
          <span class="row-extra row-points num" data-ui="summaryNetPoints"></span>
        </div>
      </div>
    </div>
    <div class="ticker"><span class="ticker-arrow" aria-hidden="true"></span><span data-ui="summaryPrompt"></span></div>
  </section>

  <section class="screen screen-gameover" data-ui="gameoverScreen">
    <div class="scrim scrim-bad"></div>
    <div class="report">
      <div class="report-card panel" data-ui="gameoverCard">
        <div class="sign report-sign"><span>Shift report</span><span class="num">Operator #0451</span></div>
        <div class="report-body">
          <div class="stamp stamp-bad">Pulled off the line</div>
          <p class="report-headline">You've been reassigned to the depot.</p>
          <p class="report-detail num" data-ui="gameoverDetail"></p>
          ${shiftStatsTemplate()}
          <p class="report-fineprint">Please hand in your hat at the front desk.</p>
        </div>
      </div>
    </div>
    <div class="ticker"><span class="ticker-arrow" aria-hidden="true"></span><span>Press Enter to try another shift</span></div>
  </section>

  <section class="screen screen-shiftcomplete" data-ui="shiftcompleteScreen">
    <div class="scrim scrim-good"></div>
    <div class="report">
      <div class="report-card panel" data-ui="shiftcompleteCard">
        <div class="sign report-sign"><span>Shift report</span><span class="num">Operator #0451</span></div>
        <div class="report-body">
          <div class="stamp stamp-good">Shift complete</div>
          <p class="report-headline">Everyone who mattered got home. Probably.</p>
          <p class="report-detail num" data-ui="shiftcompleteDetail"></p>
          <!-- Star rating (AC 22) and best score (AC 25) go in this slot; see updateShiftCompleteScreen(). -->
          <div class="report-extras" data-ui="shiftcompleteExtras"></div>
          ${shiftStatsTemplate()}
          <p class="report-fineprint">The depot will have to wait.</p>
        </div>
      </div>
    </div>
    <div class="ticker"><span class="ticker-arrow" aria-hidden="true"></span><span>Press Enter to start a new shift</span></div>
  </section>

  <div class="transition-doors" data-ui="transitionDoors" data-phase="idle" aria-hidden="true">
    <div class="door-leaf door-leaf-left"><div class="door-window"></div><div class="door-plate">Last</div></div>
    <div class="door-leaf door-leaf-right"><div class="door-window"></div><div class="door-plate">Train</div></div>
  </div>

  <div class="renderer-badge" data-ui="rendererBadge"></div>
`;

// ---- Cheap DOM writes ----
// render() runs every frame, but most frames almost nothing changes. These
// helpers remember the last value they wrote to each element and skip the write
// when it's the same, so an idle frame causes no style or layout work at all.

const lastWrittenText = new WeakMap(); // element -> string
const lastWrittenProps = new WeakMap(); // element -> { 'class:x' | 'data:x' | 'style:x' -> value }

function setText(element, text) {
  if (lastWrittenText.get(element) === text) return;
  lastWrittenText.set(element, text);
  element.textContent = text;
}

// Returns true when `value` differs from what was last written under `key`.
function rememberIfChanged(element, key, value) {
  let props = lastWrittenProps.get(element);
  if (!props) {
    props = {};
    lastWrittenProps.set(element, props);
  }
  if (props[key] === value) return false;
  props[key] = value;
  return true;
}

function setClass(element, className, isOn) {
  if (rememberIfChanged(element, `class:${className}`, isOn)) element.classList.toggle(className, isOn);
}

// data-* attributes drive multi-state styling, e.g. data-state="closing".
function setData(element, name, value) {
  if (rememberIfChanged(element, `data:${name}`, value)) element.dataset[name] = value;
}

function setStyle(element, property, value) {
  if (rememberIfChanged(element, `style:${property}`, value)) element.style.setProperty(property, value);
}

// ---- Motion ----

const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');

// One-shot animations (score pop, shakes) use the Web Animations API instead of
// re-adding CSS classes, so they can restart mid-flight without forcing a reflow.
// Skipped entirely for players who asked for less motion.
function playMotion(element, keyframes, options) {
  if (reducedMotionQuery.matches) return;
  element.animate(keyframes, options);
}

function shake(element, { distance = '1.2cqw', durationMs = 420, delayMs = 0 } = {}) {
  const at = (factor) => ({ transform: `translateX(calc(${distance} * ${factor}))` });
  playMotion(element, [at(0), at(-1), at(0.85), at(-0.6), at(0.35), at(-0.15), at(0)], {
    duration: durationMs,
    delay: delayMs,
    easing: 'ease-out',
  });
}

// ---- Small helpers ----

function collectElements(root) {
  const elements = {};
  for (const element of root.querySelectorAll('[data-ui]')) elements[element.dataset.ui] = element;
  return elements;
}

// Makes sure `container` has exactly `count` children built by makeChild(index).
// Used for things whose count comes from uiState (stations on the line, doors),
// built on the first frame that knows the count instead of in the template.
function ensureChildren(container, count, makeChild) {
  if (container.children.length === count) return container.children;
  container.replaceChildren(...Array.from({ length: count }, (_, index) => makeChild(index)));
  return container.children;
}

function makeElement(tagName, className) {
  const element = document.createElement(tagName);
  element.className = className;
  return element;
}

function formatSeconds(seconds) {
  return `${Math.floor(seconds)}s`;
}

// Scores can go negative; use a real minus so "-3" lines up with "+3".
function formatScore(score) {
  return score < 0 ? `${MINUS_SIGN}${-score}` : String(score);
}

function formatPoints(points) {
  if (points > 0) return `+${points}`;
  if (points < 0) return `${MINUS_SIGN}${-points}`;
  return '0';
}

function delayLevel(fraction) {
  if (fraction >= DELAY_METER_LEVELS.dangerFraction) return 'danger';
  if (fraction >= DELAY_METER_LEVELS.warnFraction) return 'warn';
  return 'ok';
}

// The little route diagram: one dot per station, filled up to where we are.
// passedThrough = how many stations are behind us; the next one is "current".
function updateLineMap(container, stationCount, passedThrough) {
  const dots = ensureChildren(container, stationCount, () => makeElement('i', 'line-dot'));
  for (let index = 0; index < dots.length; index++) {
    let state = 'ahead';
    if (index < passedThrough) state = 'passed';
    else if (index === passedThrough) state = 'current';
    setData(dots[index], 'state', state);
  }
}

// Shared by the HUD and the summary board: the bar fills toward the limit and
// changes color as it gets close (CSS reads data-level).
function updateDelayMeter(meterElement, fillElement, totalDelaySeconds, delayLimitSeconds) {
  const fraction = Math.min(1, Math.max(0, totalDelaySeconds / delayLimitSeconds));
  // scaleX instead of width: it animates on the compositor and never causes layout.
  setStyle(fillElement, 'transform', `scaleX(${fraction.toFixed(3)})`);
  setData(meterElement, 'level', delayLevel(fraction));
}

// One dry line from the operator's logbook, picked from how the stop went. Pure
// flavor (spec "Feel": tense but silly; losing should be funny, not punishing).
function summaryRemark(result) {
  const wasLate = result.delayAddedSeconds > 0;
  if (result.boardedCount === 0) return 'Nobody got on. Bold strategy.';
  if (result.leftBehindCount === 0 && !wasLate) return 'Everyone aboard, on time. Frame this one.';
  if (result.leftBehindCount === 0) return 'Nobody left behind. The timetable has notes.';
  if (result.leftOnStairsCount > 0 && !wasLate) return 'Right on time. The stairs are still full of people.';
  if (!wasLate) return 'Right on time. Some of them are still waving.';
  return 'Late AND people left behind. A classic.';
}

// The four figures on a shift report card, looked up once at init.
function collectShiftStats(cardElement) {
  const stat = (name) => cardElement.querySelector(`[data-stat="${name}"]`);
  return { boarded: stat('boarded'), leftBehind: stat('leftBehind'), totalDelay: stat('totalDelay'), score: stat('score') };
}

function writeShiftStats(statElements, shift) {
  setText(statElements.boarded, String(shift.boardedCount));
  setText(statElements.leftBehind, String(shift.leftBehindCount));
  setText(statElements.totalDelay, formatSeconds(shift.totalDelaySeconds));
  setText(statElements.score, formatScore(shift.score));
}

// ---- Entry points ----

const UI = {
  root: null,
  elements: null,
  screensByGroup: null,
  gameoverStats: null, // from collectShiftStats()
  shiftcompleteStats: null,
  // The group whose panel is on screen. Lags uiState.screen while the transition
  // doors are closing, so the old panel stays up until it's hidden.
  displayedGroup: null,
  doorPhase: 'idle', // 'idle' | 'closing' | 'closed' | 'opening'
  doorPhaseStartedMs: 0,
  nowMs: 0,
  // What the HUD showed last frame; null while the HUD is hidden, so a new
  // station or shift never animates a "score changed" from the old value.
  shownScore: null,
  scoreDeltaTotal: 0,
  scoreDeltaShownAtMs: -Infinity,
  shownAnnouncement: null,
  shownFlash: null,

  init(container) {
    this.root = container;
    container.innerHTML = UI_TEMPLATE;
    container.style.setProperty('--ui-doors-close-ms', `${UI_TIMING.doorsCloseMs}ms`);
    container.style.setProperty('--ui-doors-open-ms', `${UI_TIMING.doorsOpenMs}ms`);
    this.elements = collectElements(container);
    this.screensByGroup = {
      play: this.elements.playScreen,
      intro: this.elements.introScreen,
      title: this.elements.titleScreen,
      summary: this.elements.summaryScreen,
      gameover: this.elements.gameoverScreen,
      shiftcomplete: this.elements.shiftcompleteScreen,
    };
    this.gameoverStats = collectShiftStats(this.elements.gameoverCard);
    this.shiftcompleteStats = collectShiftStats(this.elements.shiftcompleteCard);
  },

  render(uiState) {
    this.nowMs = performance.now();
    this.updateScreenTransition(uiState);
    this.updateScreenContent(uiState);
    setText(this.elements.rendererBadge, uiState.rendererName);
  },

  // ---- Screen changes ----

  // Moving INTO the summary or game over straight from gameplay plays the panel's
  // own entrance instead of the doors: the player should watch the train pull out
  // past the people they left behind, or see the moment the delay ran out. The
  // intro shot hands over to play the same way: it ends on the gameplay view, so
  // a cut would spoil it. Every other change of screen (start a shift, next
  // station, clock out) closes the doors over it, which also hides the world
  // jumping to the next station.
  updateScreenTransition(uiState) {
    const targetGroup = SCREEN_GROUPS[uiState.screen];
    if (this.doorPhase === 'idle' && targetGroup !== this.displayedGroup) {
      const isFirstFrame = this.displayedGroup === null;
      const isFromLiveWorld = this.displayedGroup === 'play' || this.displayedGroup === 'intro';
      if (isFirstFrame || isFromLiveWorld || reducedMotionQuery.matches) {
        this.showGroup(targetGroup);
      } else {
        this.setDoorPhase('closing');
      }
    }

    const phaseMs = this.nowMs - this.doorPhaseStartedMs;
    if (this.doorPhase === 'closing' && phaseMs >= UI_TIMING.doorsCloseMs) {
      this.setDoorPhase('closed');
      // Swap with every transition switched off: nobody can see it, and the new
      // panel must be fully in place (not mid-fade) when the doors open.
      setClass(this.root, 'ui-instant', true);
      this.showGroup(targetGroup);
    } else if (this.doorPhase === 'closed' && phaseMs >= UI_TIMING.doorsHoldMs) {
      // Entrance animations of the new panel (e.g. the shift-complete stamp)
      // were paused by ui-instant, so they play now, as the doors open.
      setClass(this.root, 'ui-instant', false);
      this.setDoorPhase('opening');
    } else if (this.doorPhase === 'opening' && phaseMs >= UI_TIMING.doorsOpenMs) {
      this.setDoorPhase('idle');
    }
  },

  setDoorPhase(phase) {
    this.doorPhase = phase;
    this.doorPhaseStartedMs = this.nowMs;
    setData(this.elements.transitionDoors, 'phase', phase);
  },

  showGroup(group) {
    this.displayedGroup = group;
    for (const [name, screenElement] of Object.entries(this.screensByGroup)) {
      setClass(screenElement, 'is-active', name === group);
    }
    if (group !== 'play') this.shownScore = null;
    if (group === 'gameover') {
      // Lands right after the stamp hits the card (see .stamp in ui.css). The
      // card is inside a .report wrapper that does the centering, because a
      // shake replaces the transform of whatever it animates.
      shake(this.elements.gameoverCard, { distance: '1.4cqw', durationMs: 480, delayMs: 380 });
    }
  },

  // Panels are refreshed only while the game is actually in their state. During
  // a door transition the old panel stays exactly as it was: a new shift resets
  // the totals the moment Enter is pressed, and the game-over card shouldn't
  // count down to zero while the doors close over it.
  updateScreenContent(uiState) {
    switch (uiState.screen) {
      case 'intro':
        if (this.displayedGroup === 'intro') this.updateIntroScreen(uiState);
        break;
      case 'arriving':
      case 'station':
      case 'departing':
        if (this.displayedGroup === 'play') this.updatePlayScreen(uiState);
        break;
      case 'summary':
        this.updateSummaryScreen(uiState);
        break;
      case 'gameover':
        this.updateGameOverScreen(uiState);
        break;
      case 'shiftcomplete':
        this.updateShiftCompleteScreen(uiState);
        break;
      default: // title: static text, nothing to update
    }
  },

  // ---- Gameplay: HUD (AC 9), announcements (AC 19), flash warnings ----

  updatePlayScreen(uiState) {
    const { hud, screen } = uiState;
    const els = this.elements;

    // AC 9 + AC 21: station number and name, always visible.
    setText(els.hudStationNumber, `Station ${hud.stationNumber} / ${uiState.stationCount}`);
    setText(els.hudStationName, hud.stationName);
    updateLineMap(els.hudLineMap, uiState.stationCount, hud.stationNumber - 1);

    this.updateDwell(hud.dwellSecondsLeft, screen);
    // Everyone still on the stairs counts as left behind if you go now (AC 8).
    setText(els.comingValue, hud.stillComingCount > 0 ? `${hud.stillComingCount} still coming` : 'all here');
    this.updateDoorLights(uiState.doors, screen);
    setText(els.delayValue, `${formatSeconds(hud.totalDelaySeconds)} / ${hud.delayLimitSeconds}s`);
    updateDelayMeter(els.delayBlock, els.delayFill, hud.totalDelaySeconds, hud.delayLimitSeconds);
    this.updateScore(hud.score);
    this.updateAnnouncement(uiState.announcement);
    this.updateFlash(uiState.flashMessage);
    this.updateArrivalCard(uiState);
  },

  // Counts down the scheduled dwell. Once it runs out it turns red and shows how
  // late we are, which is exactly the delay being added right now (AC 10).
  updateDwell(dwellSecondsLeft, screen) {
    const els = this.elements;
    const isLate = dwellSecondsLeft < 0;
    // Reads "+3.6s late" when late; the " late" is a separate, smaller span
    // (shown by .is-late) so the readout always fits its panel.
    setText(els.dwellValue, isLate ? `+${(-dwellSecondsLeft).toFixed(1)}s` : `${dwellSecondsLeft.toFixed(1)}s`);
    setText(els.dwellLabel, isLate && screen === 'station' ? 'Behind schedule' : DWELL_LABELS[screen]);
    setClass(els.dwellPanel, 'is-late', isLate);
    // The timer only runs during 'station'; dim it while arriving / departing.
    setClass(els.dwellPanel, 'is-standby', screen !== 'station');
  },

  // A compact status light per door. The world also shows the doors; this is
  // the at-a-glance version, plus a "Space: depart" hint that lights up only
  // when departing is actually allowed (all four closed, AC 7).
  updateDoorLights(doors, screen) {
    const lights = ensureChildren(this.elements.doorLights, doors.length, () => {
      const light = makeElement('span', 'door-light');
      light.append(makeElement('span', 'door-light-label'), makeElement('i', 'door-light-hold'));
      return light;
    });
    doors.forEach((door, index) => {
      const light = lights[index];
      setText(light.firstChild, door.label);
      setData(light, 'state', door.isLocked ? 'held' : door.state);
      if (door.isLocked) {
        // The bar drains as the Door Blocker's hold (AC 17) runs out.
        const holdFraction = door.lockedSecondsLeft / CONFIG.blockerDoorLockSeconds;
        setStyle(light.lastChild, 'transform', `scaleX(${holdFraction.toFixed(2)})`);
      }
    });
    const canDepart = screen === 'station' && doors.every((door) => door.state === 'closed');
    setClass(this.elements.departHint, 'is-ready', canDepart);
  },

  updateScore(score) {
    const els = this.elements;
    if (this.shownScore !== null && score !== this.shownScore) this.playScoreChange(score - this.shownScore);
    this.shownScore = score;
    setText(els.scoreValue, formatScore(score));
  },

  // Pops the score and flashes the change next to it. Several boardings in
  // quick succession add up into one "+3" instead of flickering "+1"s.
  playScoreChange(delta) {
    const els = this.elements;
    const isPreviousStillShowing = this.nowMs - this.scoreDeltaShownAtMs < UI_TIMING.scoreDeltaMs * 0.6;
    this.scoreDeltaTotal = isPreviousStillShowing ? this.scoreDeltaTotal + delta : delta;
    this.scoreDeltaShownAtMs = this.nowMs;

    setText(els.scoreDelta, formatPoints(this.scoreDeltaTotal));
    let tone = 'good';
    if (this.scoreDeltaTotal < 0) tone = 'bad';
    else if (delta >= 5) tone = 'vip'; // a VIP is the only +5
    setData(els.scoreDelta, 'tone', tone);

    playMotion(els.scoreValue, [{ transform: 'scale(1)' }, { transform: 'scale(1.25)' }, { transform: 'scale(1)' }], {
      duration: 280,
      easing: 'ease-out',
    });
    // Opacity-only fallback so reduced-motion players still see the change.
    const frames = reducedMotionQuery.matches
      ? [{ opacity: 0 }, { opacity: 1, offset: 0.15 }, { opacity: 1, offset: 0.7 }, { opacity: 0 }]
      : [
        { opacity: 0, transform: 'translateX(0.8cqw) scale(0.7)' },
        { opacity: 1, transform: 'translateX(0) scale(1.1)', offset: 0.15 },
        { opacity: 1, transform: 'translateX(0) scale(1)', offset: 0.7 },
        { opacity: 0, transform: 'translateX(-0.6cqw) scale(1)' },
      ];
    els.scoreDelta.animate(frames, { duration: UI_TIMING.scoreDeltaMs, easing: 'ease-out' });
  },

  // The PA banner hangs under the HUD bar. When it goes away the text is kept so
  // it can fade out; a newer announcement replaces the current one with a flick.
  updateAnnouncement(text) {
    const els = this.elements;
    if (text !== null && text !== this.shownAnnouncement) {
      const isReplacing = this.shownAnnouncement !== null;
      setText(els.paText, text);
      if (isReplacing) {
        playMotion(els.paText, [
          { opacity: 0, transform: 'translateY(-60%)' },
          { opacity: 1, transform: 'translateY(0)' },
        ], { duration: 220, easing: 'ease-out' });
      }
    }
    this.shownAnnouncement = text;
    setClass(els.pa, 'is-visible', text !== null);
  },

  // Short warnings like "Close all doors first!": big, red, shakes once, then
  // fades by itself (main.js clears it after CONFIG.flashMessageSeconds).
  updateFlash(text) {
    const els = this.elements;
    if (text !== null && text !== this.shownFlash) {
      setText(els.flashText, text);
      shake(els.flashPlate, { delayMs: 60 });
    }
    this.shownFlash = text;
    setClass(els.flash, 'is-visible', text !== null);
  },

  // A platform sign while the train glides in: which station, and how long we
  // get here. Gone the moment the dwell timer starts.
  updateArrivalCard(uiState) {
    const els = this.elements;
    const isArriving = uiState.screen === 'arriving';
    if (isArriving) {
      const { hud } = uiState;
      setText(els.arrivalNumber, String(hud.stationNumber));
      setText(els.arrivalName, hud.stationName);
      setText(els.arrivalMeta, `Station ${hud.stationNumber} of ${uiState.stationCount}  ·  ${Math.round(hud.dwellSecondsLeft)} seconds to board`);
    }
    setClass(els.arrival, 'is-visible', isArriving);
  },

  // ---- Intro shot ----

  updateIntroScreen(uiState) {
    const els = this.elements;
    const { seconds } = uiState.intro;
    const isBetween = ([start, end]) => seconds >= start && seconds < end;
    setClass(els.introCaption, 'is-visible', isBetween(INTRO_TIMING.driverCaption));

    const { hud } = uiState;
    setText(els.introArrivalNumber, String(hud.stationNumber));
    setText(els.introArrivalName, hud.stationName);
    setText(els.introArrivalMeta, `Station ${hud.stationNumber} of ${uiState.stationCount}  ·  ${Math.round(hud.dwellSecondsLeft)} seconds to board`);
    setClass(els.introArrival, 'is-visible', isBetween(INTRO_TIMING.stationSign));

    // 1 = full letterbox, 0 = gone. Eased so the bars glide off rather than slide.
    const [retractStart, retractEnd] = INTRO_TIMING.letterboxRetract;
    const t = Math.max(0, Math.min(1, (seconds - retractStart) / (retractEnd - retractStart)));
    setStyle(els.introScreen, '--letterbox', (1 - t * t * (3 - 2 * t)).toFixed(3));
  },

  // ---- Station summary (AC 11) ----

  updateSummaryScreen(uiState) {
    const els = this.elements;
    const result = uiState.lastStationResult;
    const { shift, hud } = uiState;

    setText(els.summaryStationName, result.stationName);
    setText(els.summaryStationNumber, `Station ${result.stationNumber} / ${uiState.stationCount}`);
    updateLineMap(els.summaryLineMap, uiState.stationCount, result.stationNumber);
    setText(els.summaryRemark, summaryRemark(result));

    setText(els.summaryBoarded, String(result.boardedCount));
    const boardingPoints = result.pointsEarned - result.emptyCyclePenaltyPoints;
    setText(els.summaryBoardedPoints, formatPoints(boardingPoints));
    setClass(els.summaryBoardedPoints, 'is-good', boardingPoints > 0);
    const grumpyCount = result.boardedCount - result.happyCount;
    const boardedNotes = [];
    if (grumpyCount > 0) boardedNotes.push(`${grumpyCount} kept waiting at a shut door`);
    if (result.emptyDoorCycles > 0) boardedNotes.push(`${result.emptyDoorCycles} door${result.emptyDoorCycles === 1 ? '' : 's'} opened for nobody`);
    setText(els.summaryBoardedNote, boardedNotes.join(' · '));

    setText(els.summaryLeftBehind, String(result.leftBehindCount));
    setText(els.summaryPenaltyPoints, formatPoints(-result.penaltyPoints));
    setClass(els.summaryPenaltyPoints, 'is-bad', result.penaltyPoints > 0);
    // Spec: people still on the stairs at departure count as left behind too.
    const stairsNote = result.leftOnStairsCount > 0 ? `${result.leftOnStairsCount} never made it off the stairs` : '';
    setText(els.summaryStairsNote, stairsNote);

    const wasLate = result.delayAddedSeconds > 0;
    setText(els.summaryDelayAdded, `${result.delayAddedSeconds.toFixed(1)}s`);
    setText(els.summaryDelayTag, wasLate ? `Late ${formatPoints(-result.latePenaltyPoints)}` : `On time ${formatPoints(result.onTimeBonusPoints)}`);
    setData(els.summaryDelayTag, 'tone', wasLate ? 'bad' : 'good');

    setText(els.summaryTotalDelay, `${formatSeconds(shift.totalDelaySeconds)} / ${hud.delayLimitSeconds}s`);
    updateDelayMeter(els.summaryDelayMeter, els.summaryDelayFill, shift.totalDelaySeconds, hud.delayLimitSeconds);

    setText(els.summaryScore, formatScore(shift.score));
    setText(els.summaryNetPoints, `${formatPoints(result.netPoints)} this stop`);
    setClass(els.summaryNetPoints, 'is-good', result.netPoints > 0);
    setClass(els.summaryNetPoints, 'is-bad', result.netPoints < 0);

    setText(els.summaryPrompt, uiState.isLastStation ? 'Press Enter to clock out' : 'Press Enter for the next station');
  },

  // ---- End of shift (AC 12) ----

  updateGameOverScreen(uiState) {
    const { hud } = uiState;
    setText(
      this.elements.gameoverDetail,
      `Delay hit ${hud.delayLimitSeconds}s at Station ${uiState.endStationNumber} / ${uiState.stationCount} · ${hud.stationName}`,
    );
    writeShiftStats(this.gameoverStats, uiState.shift);
  },

  updateShiftCompleteScreen(uiState) {
    setText(
      this.elements.shiftcompleteDetail,
      `All ${uiState.stationCount} stations · clocked out at ${uiState.hud.stationName}`,
    );
    // AC 22: 1-3 stars (main.js shiftStars(), thresholds in CONFIG.starScoreFractions).
    setText(this.elements.shiftcompleteExtras, '★★★'.slice(0, uiState.stars) + '☆☆☆'.slice(uiState.stars));
    // TODO(AC 25): show / save best score (localStorage) here, in the same slot.
    writeShiftStats(this.shiftcompleteStats, uiState.shift);
  },
};
