// The train and its four doors. A Door is a small state machine:
//
//   CLOSED --toggle--> OPEN --toggle--> CLOSING --(doorCloseSeconds)--> CLOSED
//                       ^                  |
//                       +-----toggle-------+   (pressing again mid-close reopens it)
//
// Passengers can board while a door is OPEN or CLOSING (spec step 5 / AC 14);
// only a fully CLOSED door stops them.

const DOOR_STATE = {
  CLOSED: 'closed',
  OPEN: 'open',
  CLOSING: 'closing',
};

const TRAIN_COLORS = {
  body: '#c9ced6',
  roof: '#9aa1ab',
  stripe: '#2f6fd6',
  window: '#3b4a5c',
  doorPanel: '#dde2e8',
  doorPanelEdge: '#7d858f',
  doorway: '#11141a', // what you see through an open door
  labelClosed: '#ff5a4f',
  labelClosing: '#ffb03f',
  labelOpen: '#6fdc7a',
};

class Door {
  constructor(index, centerX) {
    this.index = index;
    this.label = String(index + 1); // doors are labeled 1-4 left to right (AC 2)
    this.centerX = centerX;
    this.state = DOOR_STATE.CLOSED; // the train always pulls in with doors closed
    this.closeProgress = 0; // 0 -> 1 over CONFIG.doorCloseSeconds while CLOSING
  }

  toggle() {
    // TODO(AC 17): Door Blocker lock. A door a Blocker forced open ignores its key
    // for 2 s. Add a `lockedSecondsLeft` field, return early here while it's > 0,
    // and count it down in update(). The blocker check itself lives in
    // StationRound.update (round.js) because only the round knows where passengers are.
    if (this.state === DOOR_STATE.CLOSED || this.state === DOOR_STATE.CLOSING) {
      this.open();
    } else {
      this.startClosing();
    }
  }

  open() {
    this.state = DOOR_STATE.OPEN;
    this.closeProgress = 0;
  }

  startClosing() {
    this.state = DOOR_STATE.CLOSING;
    this.closeProgress = 0;
    // TODO(AC 19): announce "Stand clear of the closing doors!" here.
    // TODO(AC 24): door chime sound would also start here.
  }

  update(dt) {
    if (this.state !== DOOR_STATE.CLOSING) return;
    this.closeProgress += dt / CONFIG.doorCloseSeconds;
    if (this.closeProgress >= 1) {
      this.state = DOOR_STATE.CLOSED;
      this.closeProgress = 0;
    }
  }

  canBoard() {
    return this.state !== DOOR_STATE.CLOSED;
  }

  isClosed() {
    return this.state === DOOR_STATE.CLOSED;
  }

  // How far apart the two door leaves are: 1 = fully open, 0 = shut.
  openFraction() {
    if (this.state === DOOR_STATE.OPEN) return 1;
    if (this.state === DOOR_STATE.CLOSING) return 1 - this.closeProgress;
    return 0;
  }

  draw(ctx) {
    const { doorWidth, doorHeight, trainBottom } = CONFIG.layout;
    const left = this.centerX - doorWidth / 2;
    const top = trainBottom - doorHeight - 6;

    // Dark doorway behind the leaves, visible when they slide apart.
    ctx.fillStyle = TRAIN_COLORS.doorway;
    ctx.fillRect(left, top, doorWidth, doorHeight);

    // Two leaves that slide outward from the middle, like a real subway door.
    const leafWidth = (doorWidth / 2) * (1 - this.openFraction());
    ctx.fillStyle = TRAIN_COLORS.doorPanel;
    ctx.strokeStyle = TRAIN_COLORS.doorPanelEdge;
    ctx.lineWidth = 2;
    if (leafWidth > 0.5) {
      ctx.fillRect(left, top, leafWidth, doorHeight);
      ctx.strokeRect(left, top, leafWidth, doorHeight);
      ctx.fillRect(left + doorWidth - leafWidth, top, leafWidth, doorHeight);
      ctx.strokeRect(left + doorWidth - leafWidth, top, leafWidth, doorHeight);
    }
    ctx.strokeRect(left, top, doorWidth, doorHeight);

    // Number badge above each door, colored by state so you can read all four
    // doors at a glance without staring at the leaves.
    const badgeColor = {
      [DOOR_STATE.CLOSED]: TRAIN_COLORS.labelClosed,
      [DOOR_STATE.CLOSING]: TRAIN_COLORS.labelClosing,
      [DOOR_STATE.OPEN]: TRAIN_COLORS.labelOpen,
    }[this.state];
    const badgeY = top - 20;
    ctx.fillStyle = badgeColor;
    ctx.beginPath();
    ctx.arc(this.centerX, badgeY, 15, 0, Math.PI * 2);
    ctx.fill();
    drawText(ctx, this.label, this.centerX, badgeY + 1, { size: 20, weight: 'bold', color: '#111', align: 'center' });
  }
}

class Train {
  constructor() {
    const { trainLeft, trainRight } = CONFIG.layout;
    const trainWidth = trainRight - trainLeft;
    // Doors sit at the centers of four equal sections of the car.
    this.doors = [0, 1, 2, 3].map((index) => new Door(index, trainLeft + (trainWidth * (index + 0.5)) / 4));
  }

  update(dt) {
    for (const door of this.doors) door.update(dt);
  }

  allDoorsClosed() {
    return this.doors.every((door) => door.isClosed());
  }

  draw(ctx) {
    const { trainLeft, trainRight, trainTop, trainBottom, doorWidth } = CONFIG.layout;
    const trainWidth = trainRight - trainLeft;
    const trainHeight = trainBottom - trainTop;

    ctx.fillStyle = TRAIN_COLORS.body;
    ctx.fillRect(trainLeft, trainTop, trainWidth, trainHeight);
    ctx.fillStyle = TRAIN_COLORS.roof;
    ctx.fillRect(trainLeft, trainTop, trainWidth, 10);
    ctx.fillStyle = TRAIN_COLORS.stripe;
    ctx.fillRect(trainLeft, trainBottom - 34, trainWidth, 10);

    // One window between each pair of doors (and at both ends of the car).
    ctx.fillStyle = TRAIN_COLORS.window;
    const windowTop = trainTop + 40;
    const windowHeight = 50;
    const edges = [trainLeft, ...this.doors.map((door) => door.centerX), trainRight];
    for (let i = 0; i < edges.length - 1; i++) {
      const gapLeft = edges[i] + (i === 0 ? 12 : doorWidth / 2 + 14);
      const gapRight = edges[i + 1] - (i === edges.length - 2 ? 12 : doorWidth / 2 + 14);
      if (gapRight - gapLeft > 20) ctx.fillRect(gapLeft, windowTop, gapRight - gapLeft, windowHeight);
    }

    for (const door of this.doors) door.draw(ctx);
  }
}
