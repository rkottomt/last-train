// The train and its four doors. A Door is a small state machine:
//
//   CLOSED --toggle--> OPEN --toggle--> CLOSING --(doorCloseSeconds)--> CLOSED
//                       ^                  |
//                       +-----toggle-------+   (pressing again mid-close reopens it)
//
// Passengers can board while a door is OPEN or CLOSING (spec step 5 / AC 14);
// only a fully CLOSED door stops them.
//
// Game logic only: no drawing. Renderers (src/render/) read door.centerX, label,
// state, openFraction() and isLocked(). Opening is instant in the rules, so
// renderers may smooth the leaves' visual position toward openFraction().

const DOOR_STATE = {
  CLOSED: 'closed',
  OPEN: 'open',
  CLOSING: 'closing',
};

class Door {
  constructor(index, centerX) {
    this.index = index;
    this.label = String(index + 1); // doors are labeled 1-4 left to right (AC 2)
    this.centerX = centerX;
    this.state = DOOR_STATE.CLOSED; // the train always pulls in with doors closed
    this.closeProgress = 0; // 0 -> 1 over CONFIG.doorCloseSeconds while CLOSING
    // While > 0 a Door Blocker is holding this door open and its key does nothing (AC 17).
    this.lockedSecondsLeft = 0;
  }

  isLocked() {
    return this.lockedSecondsLeft > 0;
  }

  toggle() {
    if (this.isLocked()) return;
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
    // (The "Stand clear" announcement is made by StationRound.toggleDoor.)
    // TODO(AC 24): door chime sound would start here.
  }

  // A Door Blocker stuck his arm in: pop back open and ignore the key for a while.
  // Called by StationRound, which is the only thing that knows where passengers are.
  forceOpenByBlocker() {
    this.open();
    this.lockedSecondsLeft = CONFIG.blockerDoorLockSeconds;
  }

  update(dt) {
    if (this.lockedSecondsLeft > 0) this.lockedSecondsLeft = Math.max(0, this.lockedSecondsLeft - dt);
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
}
