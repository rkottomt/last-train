// Keyboard input. Key presses are turned into named actions and queued; main.js
// drains the queue once per frame and routes each action to the current game
// state. Input never touches game state directly, so a new control is just a new
// KEY_TO_ACTION entry plus a case in whichever state cares about it.

// Keyed by KeyboardEvent.code (physical key), so the controls work the same on
// any keyboard layout.
const KEY_TO_ACTION = {
  Digit1: { type: 'toggleDoor', doorIndex: 0 },
  Digit2: { type: 'toggleDoor', doorIndex: 1 },
  Digit3: { type: 'toggleDoor', doorIndex: 2 },
  Digit4: { type: 'toggleDoor', doorIndex: 3 },
  Numpad1: { type: 'toggleDoor', doorIndex: 0 },
  Numpad2: { type: 'toggleDoor', doorIndex: 1 },
  Numpad3: { type: 'toggleDoor', doorIndex: 2 },
  Numpad4: { type: 'toggleDoor', doorIndex: 3 },
  Space: { type: 'depart' },
  Enter: { type: 'confirm' }, // start / next station / restart
  NumpadEnter: { type: 'confirm' },
  KeyP: { type: 'pause' },
  KeyR: { type: 'restart' }, // restart the shift from station 1, any time
};

const Input = {
  queuedActions: [],

  init() {
    window.addEventListener('keydown', (event) => {
      const action = KEY_TO_ACTION[event.code];
      if (!action) return;
      // Stop Space from scrolling the page and Enter from activating focused elements.
      event.preventDefault();
      // Holding a key auto-repeats; ignore that or a held "1" would flap the door.
      if (event.repeat) return;
      this.queuedActions.push(action);
    });
  },

  // Returns every action since the last call, oldest first, and empties the queue.
  drainActions() {
    const actions = this.queuedActions;
    this.queuedActions = [];
    return actions;
  },
};
