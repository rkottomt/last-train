// Drawing for everything that isn't the world itself: the HUD bar along the top,
// flash messages, and the full-screen title / summary / game-over /
// shift-complete screens. These functions only read the data they're given and
// never change game state.

const HUD_COLORS = {
  barBackground: '#14161c',
  text: '#f1f1f1',
  dimText: '#9aa0aa',
  warning: '#ff5a4f',
  good: '#6fdc7a',
  accent: '#ffd23f',
  overlay: 'rgba(10, 12, 16, 0.86)',
};

const HUD_FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';

function drawText(ctx, text, x, y, { size = 18, weight = 'normal', color = HUD_COLORS.text, align = 'left' } = {}) {
  ctx.font = `${weight} ${size}px ${HUD_FONT}`;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y);
}

function drawCenteredText(ctx, text, y, options = {}) {
  drawText(ctx, text, CONFIG.canvasWidth / 2, y, { ...options, align: 'center' });
}

function fillScreen(ctx, color) {
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, CONFIG.canvasWidth, CONFIG.canvasHeight);
}

// ---- Title screen (AC 1) ----

function drawTitleScreen(ctx) {
  fillScreen(ctx, '#1b1e26');
  drawCenteredText(ctx, 'LAST TRAIN', 150, { size: 64, weight: 'bold', color: HUD_COLORS.accent });
  drawCenteredText(ctx, 'Get them home. Stay on schedule. Pick one.', 210, { size: 20, color: HUD_COLORS.dimText });

  const controls = [
    ['1  2  3  4', 'open / close that door'],
    ['Space', 'depart (all doors closed)'],
    ['Enter', 'start / next station'],
  ];
  controls.forEach(([key, meaning], row) => {
    const y = 290 + row * 34;
    drawText(ctx, key, CONFIG.canvasWidth / 2 - 20, y, { size: 20, weight: 'bold', align: 'right' });
    drawText(ctx, meaning, CONFIG.canvasWidth / 2 + 10, y, { size: 20, color: HUD_COLORS.dimText });
  });

  drawCenteredText(ctx, 'Press Enter to start your shift', 450, { size: 24, weight: 'bold' });
}

// ---- Flash message (e.g. "Close all doors first!") ----

function drawFlashMessage(ctx, text) {
  const y = 300;
  ctx.font = `bold 26px ${HUD_FONT}`;
  const boxWidth = ctx.measureText(text).width + 48;
  ctx.fillStyle = 'rgba(20, 22, 28, 0.88)';
  ctx.fillRect((CONFIG.canvasWidth - boxWidth) / 2, y - 26, boxWidth, 52);
  drawCenteredText(ctx, text, y, { size: 26, weight: 'bold', color: HUD_COLORS.warning });
}

// ---- Station announcement banner (AC 19) ----

// Drawn in the thin strip between the HUD bar and the door badges, the one place
// it can't hide a door, a passenger or the "Close all doors first!" warning.
function drawAnnouncement(ctx, text) {
  const y = CONFIG.layout.hudHeight + 17;
  ctx.font = `bold 17px ${HUD_FONT}`;
  const boxWidth = ctx.measureText(text).width + 40;
  ctx.fillStyle = 'rgba(16, 32, 64, 0.92)';
  ctx.fillRect((CONFIG.canvasWidth - boxWidth) / 2, y - 14, boxWidth, 28);
  drawCenteredText(ctx, text, y, { size: 17, weight: 'bold', color: HUD_COLORS.accent });
}

// ---- Shared layout for the stat screens ----

// rows: [[label, valueText, color?], ...] drawn as a centered two-column table.
function drawStatRows(ctx, rows, startY) {
  rows.forEach(([label, value, color], index) => {
    const y = startY + index * 36;
    drawText(ctx, label, CONFIG.canvasWidth / 2 - 16, y, { size: 22, color: HUD_COLORS.dimText, align: 'right' });
    drawText(ctx, value, CONFIG.canvasWidth / 2 + 16, y, { size: 22, weight: 'bold', color: color || HUD_COLORS.text });
  });
}

// ---- Station summary (AC 11) ----

// result: the object returned by StationRound.finish().
function drawSummaryScreen(ctx, result, shift, isLastStation) {
  fillScreen(ctx, HUD_COLORS.overlay);
  drawCenteredText(ctx, `Departed ${result.stationName}`, 110, { size: 40, weight: 'bold', color: HUD_COLORS.accent });
  drawCenteredText(ctx, `Station ${result.stationNumber} / ${STATIONS.length}`, 155, { size: 20, color: HUD_COLORS.dimText });

  const leftBehindText = result.leftOnStairsCount > 0
    ? `${result.leftBehindCount}  (${result.leftOnStairsCount} never made it off the stairs)`
    : `${result.leftBehindCount}`;
  drawStatRows(ctx, [
    ['Boarded', `${result.boardedCount}  (+${result.pointsEarned})`, HUD_COLORS.good],
    ['Left behind', `${leftBehindText}  (-${result.penaltyPoints})`, result.leftBehindCount > 0 ? HUD_COLORS.warning : HUD_COLORS.good],
    ['Delay added', `${result.delayAddedSeconds.toFixed(1)}s`],
    ['Total delay', `${Math.floor(shift.totalDelaySeconds)}s / ${CONFIG.delayLimitSeconds}s`],
    ['Score', `${shift.score}`, HUD_COLORS.accent],
  ], 220);

  const prompt = isLastStation ? 'Press Enter to clock out' : 'Press Enter for the next station';
  drawCenteredText(ctx, prompt, 460, { size: 24, weight: 'bold' });
}

// ---- End of shift (AC 12) ----

function shiftStatRows(shift) {
  return [
    ['Boarded', `${shift.boardedCount}`, HUD_COLORS.good],
    ['Left behind', `${shift.leftBehindCount}`, HUD_COLORS.warning],
    ['Total delay', `${Math.floor(shift.totalDelaySeconds)}s`],
    ['Final score', `${shift.score}`, HUD_COLORS.accent],
  ];
}

// stationNumber: the station where the delay limit was hit.
function drawGameOverScreen(ctx, shift, stationNumber) {
  fillScreen(ctx, '#2a1416');
  drawCenteredText(ctx, 'PULLED OFF THE LINE', 105, { size: 44, weight: 'bold', color: HUD_COLORS.warning });
  drawCenteredText(ctx, "You've been reassigned to the depot.", 160, { size: 24 });
  drawCenteredText(ctx, `Delay hit ${CONFIG.delayLimitSeconds}s at station ${stationNumber} / ${STATIONS.length}`, 198, {
    size: 18, color: HUD_COLORS.dimText,
  });
  drawStatRows(ctx, shiftStatRows(shift), 260);
  drawCenteredText(ctx, 'Press Enter to try another shift', 460, { size: 24, weight: 'bold' });
}

function drawShiftCompleteScreen(ctx, shift) {
  fillScreen(ctx, '#142a1a');
  drawCenteredText(ctx, 'SHIFT COMPLETE', 105, { size: 44, weight: 'bold', color: HUD_COLORS.good });
  drawCenteredText(ctx, 'Everyone who mattered got home. Probably.', 160, { size: 22 });
  // TODO(AC 22): 1-3 star rating here, from shift.score. Pick thresholds by
  // playtesting and put them in CONFIG (e.g. CONFIG.starScoreThresholds = [a, b, c]).
  // TODO(AC 25): show / save best score (localStorage) here.
  drawStatRows(ctx, shiftStatRows(shift), 240);
  drawCenteredText(ctx, 'Press Enter to start a new shift', 460, { size: 24, weight: 'bold' });
}

// ---- HUD bar (AC 9) ----

// hudInfo: { stationNumber, stationCount, stationName, dwellSecondsLeft,
//            totalDelaySeconds, delayLimitSeconds, score }
function drawHud(ctx, hudInfo) {
  const barHeight = CONFIG.layout.hudHeight;
  const centerY = barHeight / 2;
  ctx.fillStyle = HUD_COLORS.barBackground;
  ctx.fillRect(0, 0, CONFIG.canvasWidth, barHeight);

  drawText(ctx, `Station ${hudInfo.stationNumber} / ${hudInfo.stationCount}, ${hudInfo.stationName}`, 16, centerY, {
    size: 18, weight: 'bold',
  });

  // Once dwell runs out the timer turns red and shows how far over schedule we are,
  // because that's exactly the time being added to the delay (AC 10).
  const isOverDwell = hudInfo.dwellSecondsLeft <= 0;
  const dwellText = isOverDwell
    ? `Dwell 0.0s  (+${(-hudInfo.dwellSecondsLeft).toFixed(1)}s late)`
    : `Dwell ${hudInfo.dwellSecondsLeft.toFixed(1)}s`;
  drawText(ctx, dwellText, 420, centerY, { size: 18, color: isOverDwell ? HUD_COLORS.warning : HUD_COLORS.text });

  const delayIsHigh = hudInfo.totalDelaySeconds >= hudInfo.delayLimitSeconds * 0.75;
  drawText(ctx, `Delay ${Math.floor(hudInfo.totalDelaySeconds)}s / ${hudInfo.delayLimitSeconds}s`, 690, centerY, {
    size: 18, color: delayIsHigh ? HUD_COLORS.warning : HUD_COLORS.text,
  });

  drawText(ctx, `Score ${hudInfo.score}`, CONFIG.canvasWidth - 16, centerY, { size: 18, weight: 'bold', align: 'right' });
}
