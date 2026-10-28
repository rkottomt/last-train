// Canvas 2D world renderer: the fallback when WebGPU isn't available (e.g. some
// Firefox builds), so the game still runs everywhere (AC 1).
//
// RENDERER INTERFACE (shared with src/render/webgpu.js). A renderer draws the
// world only (station, train, passengers); all text UI lives in src/ui.js.
//   name               - shown in a small badge so testers know which path ran
//   init(canvas)       - Promise<boolean>; resolves false (never throws, never
//                        logs) if this renderer can't run here
//   render(view)       - draw one frame
//
// view (built fresh by main.js every frame; renderers must not modify it):
//   screen             - game.state ('title', 'arriving', 'station', ...)
//   stationName        - string, or '' on the title screen
//   train              - Train (see train.js): doors[i].centerX/openFraction()/isLocked()/label
//   passengers         - Passenger[] (see passenger.js); draw those with isVisible()
//   trainOffsetPixels  - horizontal train offset in layout pixels (0 = docked;
//                        +ve = still arriving from the right; -ve = leaving left)
//   timeSeconds        - ever-increasing clock for ambient animation
//
// Coordinates: game logic works in "layout pixels" on a 960x540 board
// (CONFIG.layout). This renderer draws in exactly those units.

const CANVAS2D_COLORS = {
  tunnelWall: '#2a2d36',
  platform: '#6b6f78',
  platformEdge: '#4b4f57',
  safetyLine: '#e8c43a',
  stairwell: '#3d4048',
  stairStep: '#565a63',
  trainBody: '#c9ced6',
  trainRoof: '#9aa1ab',
  trainStripe: '#2f6fd6',
  trainWindow: '#3b4a5c',
  doorPanel: '#dde2e8',
  doorPanelEdge: '#7d858f',
  doorway: '#11141a',
  badgeClosed: '#ff5a4f',
  badgeClosing: '#ffb03f',
  badgeOpen: '#6fdc7a',
  held: '#f08c1a',
  skin: '#f1c9a5',
  limbs: '#2b2b2b',
};

const Canvas2DRenderer = {
  name: 'Canvas 2D',
  canvas: null,
  ctx: null,

  async init(canvas) {
    const ctx = canvas.getContext('2d');
    if (!ctx) return false;
    this.canvas = canvas;
    this.ctx = ctx;
    return true;
  },

  render(view) {
    const ctx = this.ctx;
    this.matchCanvasToDisplaySize();
    ctx.save();
    // Draw in 960x540 layout pixels no matter how big the canvas really is.
    ctx.scale(this.canvas.width / CONFIG.canvasWidth, this.canvas.height / CONFIG.canvasHeight);

    this.drawStation(ctx);
    ctx.save();
    ctx.translate(view.trainOffsetPixels, 0);
    this.drawTrain(ctx, view.train);
    ctx.restore();
    this.drawPlatform(ctx);

    // Draw people further up the platform first, so nearer people overlap them.
    const visible = view.passengers.filter((passenger) => passenger.isVisible());
    visible.sort((a, b) => a.y - b.y);
    for (const passenger of visible) this.drawPassenger(ctx, passenger, view.train);

    ctx.restore();
  },

  // Keep the backing store at the on-screen size x devicePixelRatio, so lines
  // stay sharp on high-DPI screens instead of being CSS-scaled up.
  matchCanvasToDisplaySize() {
    const ratio = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.round(this.canvas.clientWidth * ratio));
    const height = Math.max(1, Math.round(this.canvas.clientHeight * ratio));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
  },

  drawStation(ctx) {
    ctx.fillStyle = CANVAS2D_COLORS.tunnelWall;
    ctx.fillRect(0, 0, CONFIG.canvasWidth, CONFIG.canvasHeight);
  },

  drawPlatform(ctx) {
    const { platformTop, trainBottom, stairwellCenterXs, stairwellWidth, stairwellTop } = CONFIG.layout;
    ctx.fillStyle = CANVAS2D_COLORS.platformEdge;
    ctx.fillRect(0, trainBottom, CONFIG.canvasWidth, platformTop - trainBottom);
    ctx.fillStyle = CANVAS2D_COLORS.platform;
    ctx.fillRect(0, platformTop, CONFIG.canvasWidth, CONFIG.canvasHeight - platformTop);
    ctx.fillStyle = CANVAS2D_COLORS.safetyLine;
    ctx.fillRect(0, platformTop + 6, CONFIG.canvasWidth, 4);

    for (const centerX of stairwellCenterXs) {
      const left = centerX - stairwellWidth / 2;
      ctx.fillStyle = CANVAS2D_COLORS.stairwell;
      ctx.fillRect(left, stairwellTop, stairwellWidth, CONFIG.canvasHeight - stairwellTop);
      ctx.fillStyle = CANVAS2D_COLORS.stairStep;
      for (let stepY = stairwellTop + 6; stepY < CONFIG.canvasHeight; stepY += 10) {
        ctx.fillRect(left + 4, stepY, stairwellWidth - 8, 4);
      }
    }
  },

  drawTrain(ctx, train) {
    const { trainLeft, trainRight, trainTop, trainBottom, doorWidth } = CONFIG.layout;
    const trainWidth = trainRight - trainLeft;
    const trainHeight = trainBottom - trainTop;

    ctx.fillStyle = CANVAS2D_COLORS.trainBody;
    ctx.fillRect(trainLeft, trainTop, trainWidth, trainHeight);
    ctx.fillStyle = CANVAS2D_COLORS.trainRoof;
    ctx.fillRect(trainLeft, trainTop, trainWidth, 10);
    ctx.fillStyle = CANVAS2D_COLORS.trainStripe;
    ctx.fillRect(trainLeft, trainBottom - 34, trainWidth, 10);

    // One window between each pair of doors (and at both ends of the car).
    ctx.fillStyle = CANVAS2D_COLORS.trainWindow;
    const windowTop = trainTop + 40;
    const windowHeight = 50;
    const edges = [trainLeft, ...train.doors.map((door) => door.centerX), trainRight];
    for (let i = 0; i < edges.length - 1; i++) {
      const gapLeft = edges[i] + (i === 0 ? 12 : doorWidth / 2 + 14);
      const gapRight = edges[i + 1] - (i === edges.length - 2 ? 12 : doorWidth / 2 + 14);
      if (gapRight - gapLeft > 20) ctx.fillRect(gapLeft, windowTop, gapRight - gapLeft, windowHeight);
    }

    for (const door of train.doors) this.drawDoor(ctx, door);
  },

  drawDoor(ctx, door) {
    const { doorWidth, doorHeight, trainBottom } = CONFIG.layout;
    const left = door.centerX - doorWidth / 2;
    const top = trainBottom - doorHeight - 6;

    ctx.fillStyle = CANVAS2D_COLORS.doorway;
    ctx.fillRect(left, top, doorWidth, doorHeight);

    // Two leaves that slide outward from the middle, like a real subway door.
    const leafWidth = (doorWidth / 2) * (1 - door.openFraction());
    ctx.fillStyle = CANVAS2D_COLORS.doorPanel;
    ctx.strokeStyle = CANVAS2D_COLORS.doorPanelEdge;
    ctx.lineWidth = 2;
    if (leafWidth > 0.5) {
      ctx.fillRect(left, top, leafWidth, doorHeight);
      ctx.strokeRect(left, top, leafWidth, doorHeight);
      ctx.fillRect(left + doorWidth - leafWidth, top, leafWidth, doorHeight);
      ctx.strokeRect(left + doorWidth - leafWidth, top, leafWidth, doorHeight);
    }
    ctx.strokeRect(left, top, doorWidth, doorHeight);

    if (door.isLocked()) {
      this.drawLabel(ctx, 'HELD', door.centerX, top + doorHeight / 2 - 10, 15, CANVAS2D_COLORS.held);
      this.drawLabel(ctx, door.lockedSecondsLeft.toFixed(1), door.centerX, top + doorHeight / 2 + 10, 14, CANVAS2D_COLORS.held);
    }

    // Number badge above each door, colored by state so you can read all four
    // doors at a glance without staring at the leaves.
    const badgeColor = {
      [DOOR_STATE.CLOSED]: CANVAS2D_COLORS.badgeClosed,
      [DOOR_STATE.CLOSING]: CANVAS2D_COLORS.badgeClosing,
      [DOOR_STATE.OPEN]: CANVAS2D_COLORS.badgeOpen,
    }[door.state];
    const badgeY = top - 20;
    ctx.fillStyle = badgeColor;
    ctx.beginPath();
    ctx.arc(door.centerX, badgeY, 15, 0, Math.PI * 2);
    ctx.fill();
    this.drawLabel(ctx, door.label, door.centerX, badgeY + 1, 20, '#111');
    this.drawDoorTimerBar(ctx, door, badgeY - 21);
  },

  // Above each door: green bar draining while open (time until it closes by
  // itself), orange bar + seconds while it recharges after closing.
  drawDoorTimerBar(ctx, door, y) {
    let fraction = 0;
    let color = null;
    if (door.state === DOOR_STATE.OPEN) {
      fraction = door.openSecondsLeft / CONFIG.doorOpenSeconds;
      color = CANVAS2D_COLORS.badgeOpen;
    } else if (door.isCoolingDown()) {
      fraction = door.cooldownSecondsLeft / CONFIG.doorCooldownSeconds;
      color = CANVAS2D_COLORS.held;
    }
    if (!color) return;
    const width = 56;
    fraction = Math.max(0, Math.min(1, fraction));
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.fillRect(door.centerX - width / 2 - 2, y - 4, width + 4, 8);
    ctx.fillStyle = color;
    ctx.fillRect(door.centerX - width / 2, y - 2, width * fraction, 4);
    if (door.isCoolingDown()) {
      // Beside the bar, not above it: above would sit under the HTML HUD bar.
      this.drawLabel(ctx, `${door.cooldownSecondsLeft.toFixed(1)}s`, door.centerX + width / 2 + 18, y, 12, color);
    }
  },

  drawLabel(ctx, text, x, y, size, color) {
    ctx.font = `bold ${size}px system-ui, sans-serif`;
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x, y);
  },

  drawPassenger(ctx, passenger, train) {
    const bodyWidth = 14;
    const bodyHeight = 20;
    const legLength = 12;
    const headRadius = 7;
    const time = passenger.animationSeconds;
    const isRunning = passenger.state === PASSENGER_STATE.RUNNING && !passenger.isCheckingPhone();
    const isWaiting = passenger.state === PASSENGER_STATE.WAITING;
    const isLeftBehind = passenger.state === PASSENGER_STATE.LEFT_BEHIND;
    const isBoarding = passenger.state === PASSENGER_STATE.BOARDED;

    let x = passenger.x;
    let feetY = passenger.y;
    ctx.save();
    if (isBoarding) {
      // Hop up and into the doorway, shrinking as they disappear inside.
      const progress = Math.min(1, passenger.secondsSinceBoarded / CONFIG.boardingAnimationSeconds);
      const door = train.doors[passenger.targetDoorIndex];
      x += (door.centerX - x) * progress;
      feetY += (CONFIG.layout.trainBottom - feetY) * progress - Math.sin(progress * Math.PI) * 14;
      ctx.globalAlpha = 1 - progress;
    }
    // Waiting passengers hop impatiently in place (AC 6: "visibly impatient").
    if (isWaiting) feetY -= Math.abs(Math.sin(time * 7)) * 3;
    // Left-behind passengers sink into a slump (AC 20).
    const slump = isLeftBehind ? 5 : 0;
    const hipY = feetY - legLength + slump * 0.4;
    const shoulderY = hipY - bodyHeight + 4 + slump * 0.6;
    const headY = hipY - bodyHeight - headRadius + 1 + slump;

    // Legs scissor and arms flail while running; faster types flail faster.
    const swing = isRunning ? Math.sin(time * 10 * passenger.type.speedMultiplier) : 0;
    ctx.strokeStyle = CANVAS2D_COLORS.limbs;
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x, hipY);
    ctx.lineTo(x - 3 + swing * 6, feetY);
    ctx.moveTo(x, hipY);
    ctx.lineTo(x + 3 - swing * 6, feetY);
    ctx.stroke();

    ctx.fillStyle = passenger.type.color;
    ctx.fillRect(x - bodyWidth / 2, hipY - bodyHeight + slump * 0.6, bodyWidth, bodyHeight - slump * 0.6);

    // Arms, mirrored left/right; angle is radians away from hanging straight down.
    const armLength = 12;
    let armAngle = 0.3;
    if (isRunning) armAngle = 1.2 + swing;
    if (isWaiting) armAngle = 2.4 + Math.sin(time * 9) * 0.3;
    if (isLeftBehind) armAngle = 0.1;
    const armReachX = Math.sin(armAngle) * armLength;
    const armReachY = Math.cos(armAngle) * armLength;
    ctx.beginPath();
    ctx.moveTo(x - bodyWidth / 2, shoulderY);
    ctx.lineTo(x - bodyWidth / 2 - armReachX, shoulderY + armReachY);
    ctx.moveTo(x + bodyWidth / 2, shoulderY);
    ctx.lineTo(x + bodyWidth / 2 + armReachX, shoulderY + armReachY);
    ctx.stroke();

    ctx.fillStyle = CANVAS2D_COLORS.skin;
    ctx.beginPath();
    ctx.arc(x, headY, headRadius, 0, Math.PI * 2);
    ctx.fill();

    if (isLeftBehind) {
      // Sad face: two dot eyes and a frown.
      ctx.fillStyle = '#222';
      ctx.fillRect(x - 3, headY - 2, 2, 2);
      ctx.fillRect(x + 1, headY - 2, 2, 2);
      ctx.strokeStyle = '#222';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(x, headY + 5, 3, Math.PI * 1.15, Math.PI * 1.85);
      ctx.stroke();
    }

    if (passenger.type.carriesBox) {
      ctx.fillStyle = '#c99a5b';
      ctx.fillRect(x - 11, hipY - 15, 22, 16);
      ctx.strokeStyle = '#7a5a30';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x - 11, hipY - 15, 22, 16);
    }

    if (passenger.isCheckingPhone()) {
      ctx.fillStyle = '#111';
      ctx.fillRect(x + 4, headY - 4, 7, 11);
      ctx.fillStyle = '#9fe6ff';
      ctx.fillRect(x + 5, headY - 3, 5, 8);
    }

    if (passenger.type.sparkles) {
      ctx.fillStyle = '#fff3a0';
      for (let i = 0; i < 3; i++) {
        const angle = time * 3 + (i * Math.PI * 2) / 3;
        const size = 2 + Math.abs(Math.sin(time * 8 + i)) * 2;
        ctx.fillRect(x + Math.cos(angle) * 16 - size / 2, headY + Math.sin(angle) * 10 - size / 2, size, size);
      }
    }
    ctx.restore();
  },
};
