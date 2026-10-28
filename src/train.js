// The train and its four doors. A Door is a small state machine:
//
//   CLOSED --toggle--> OPEN --toggle, or doorOpenSeconds run out--> CLOSING
//     ^                                                               |
//     +--(doorCloseSeconds; then doorCooldownSeconds of recharge)-----+
//
// A door only stays open for CONFIG.doorOpenSeconds (paused while someone is
// stepping through), then closes by itself. Once fully closed it recharges for a
// moment (CONFIG.doorCooldownSeconds), during which its key does nothing. The key is also ignored while closing, so a door can't be kept
// open forever by reopening it just before its timer runs out.
//
// Passengers can board while a door is OPEN or CLOSING (spec step 5 / AC 14);
// only a fully CLOSED door stops them.
//
// Game logic only: no drawing. Renderers (src/render/) read door.centerX, label,
// state, openFraction(), isLocked(), openSecondsLeft and cooldownSecondsLeft. Opening is instant in the rules, so
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
    this.openSecondsLeft = 0; // while OPEN: time until it closes by itself
    this.cooldownSecondsLeft = 0; // while CLOSED: time until it can be opened again
    // While > 0 someone is stepping through; the next person waits their turn.
    this.doorwayBusySecondsLeft = 0;
    // Boardings since the operator last opened this door; a cycle with none is
    // "empty" and StationRound charges for it (CONFIG.emptyDoorCyclePenaltyPoints).
    this.boardingsThisCycle = 0;
    this.isOperatorCycle = false; // false for a Blocker's forced reopen
    this.hasFinishedEmptyCycle = false; // set when such a cycle closes; the round clears it
  }

  isDoorwayClear() {
    return this.doorwayBusySecondsLeft <= 0;
  }

  // One passenger steps through (CONFIG.boardingSecondsPerPassenger).
  occupyDoorway() {
    this.doorwayBusySecondsLeft = CONFIG.boardingSecondsPerPassenger;
    this.boardingsThisCycle += 1;
  }

  isLocked() {
    return this.lockedSecondsLeft > 0;
  }

  isCoolingDown() {
    return this.state === DOOR_STATE.CLOSED && this.cooldownSecondsLeft > 0;
  }

  // Returns false when the press was ignored (held, closing, or recharging).
  toggle() {
    if (this.isLocked() || this.state === DOOR_STATE.CLOSING || this.isCoolingDown()) return false;
    if (this.state === DOOR_STATE.CLOSED) {
      this.open();
      this.isOperatorCycle = true;
      this.boardingsThisCycle = 0;
    } else {
      this.startClosing();
    }
    return true;
  }

  open() {
    this.state = DOOR_STATE.OPEN;
    this.closeProgress = 0;
    this.openSecondsLeft = CONFIG.doorOpenSeconds;
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
    const someoneInDoorway = !this.isDoorwayClear();
    this.doorwayBusySecondsLeft = Math.max(0, this.doorwayBusySecondsLeft - dt);
    if (this.state === DOOR_STATE.CLOSED) {
      this.cooldownSecondsLeft = Math.max(0, this.cooldownSecondsLeft - dt);
    } else if (this.state === DOOR_STATE.OPEN) {
      // A Blocker-held door stays open until the hold ends, then its timer resumes.
      // Like real door sensors, it also won't start closing on someone mid-step.
      if (!this.isLocked() && !someoneInDoorway) this.openSecondsLeft -= dt;
      if (this.openSecondsLeft <= 0) this.startClosing();
    } else {
      this.closeProgress += dt / CONFIG.doorCloseSeconds;
      if (this.closeProgress >= 1) {
        this.state = DOOR_STATE.CLOSED;
        this.closeProgress = 0;
        this.cooldownSecondsLeft = CONFIG.doorCooldownSeconds;
        if (this.isOperatorCycle && this.boardingsThisCycle === 0) this.hasFinishedEmptyCycle = true;
        this.isOperatorCycle = false;
      }
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
