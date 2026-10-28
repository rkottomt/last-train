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
