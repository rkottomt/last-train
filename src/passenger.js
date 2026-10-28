// Passenger types and the Passenger class.
//
// PASSENGER_TYPES is the single table describing every kind of passenger.
// A new type that only differs in numbers or color is just a new entry here.
// A type with a special behavior (Phone Guy stopping, Door Blocker forcing doors)
// also needs code at the TODO(AC 17/18) spots in this file and in round.js.
//
// Fields:
//   label               - name shown on screens
//   color               - body color; color is how players tell types apart (spec: Tech)
//   speedMultiplier     - run speed relative to CONFIG.commuterRunSpeed
//   points              - added to score when this passenger boards
//   leftBehindPenalty   - subtracted from score if still on the platform at departure
//   firstStation        - first station (1-8) this type can spawn at; null = never (not built yet)
//   spawnWeight         - relative chance when picking random passengers
//   guaranteedPerStation - this many are always added to each eligible station before random picks
//   carriesBox, sparkles - optional drawing extras (the renderers in src/render/ read these)

const PASSENGER_TYPES = {
  commuter: {
    label: 'Commuter',
    color: '#9ea3ab',
    speedMultiplier: 1,
    points: 1,
    leftBehindPenalty: 1,
    firstStation: 1,
    spawnWeight: 3, // the baseline crowd; everyone else is seasoning
  },
  sprinter: {
    label: 'Sprinter',
    color: '#e0453a',
    speedMultiplier: 2, // spec: "about 2x a commuter"
    points: 1,
    leftBehindPenalty: 1,
    firstStation: 1,
    spawnWeight: 1.5,
  },
  luggage: {
    label: 'Luggage',
    color: '#8b5a2b',
    speedMultiplier: 0.5, // spec: "about 0.5x a commuter"; the classic "won't make it"
    points: 1,
    leftBehindPenalty: 1,
    firstStation: 2,
    spawnWeight: 1.5,
    carriesBox: true,
  },
  vip: {
    label: 'VIP',
    color: '#f2c200',
    speedMultiplier: 1,
    points: 5,
    leftBehindPenalty: 3, // spec: leaving a VIP behind costs 3
    firstStation: 2,
    // Spec: "rare (about 1 per station)". A random weight would give some stations
    // zero and others three, so instead every station from 2 on gets exactly one.
    spawnWeight: 0,
    guaranteedPerStation: 1,
    sparkles: true,
  },
  phoneGuy: {
    label: 'Phone Guy',
    color: '#3a6fd8',
    speedMultiplier: 1,
    points: 1,
    leftBehindPenalty: 1,
    firstStation: 3,
    spawnWeight: 1.5,
    stopsForPhone: true, // randomly freezes mid-run; see Passenger.update
  },
  doorBlocker: {
    label: 'Door Blocker',
    color: '#f08c1a',
    speedMultiplier: 1,
    points: 1,
    leftBehindPenalty: 1,
    firstStation: 4,
    spawnWeight: 1,
    // Forces closing doors back open; the check is in StationRound.update (round.js).
    blocksClosingDoors: true,
  },
};

const PASSENGER_STATE = {
  RUNNING: 'running', // heading for their door's waiting spot
  WAITING: 'waiting', // at the door, which is closed; will board the moment it opens
  BOARDED: 'boarded', // on the train; drawn only for the short hop through the doors
  LEFT_BEHIND: 'leftBehind', // still on the platform when the train departed (sad, AC 20)
};

// This file is game logic only: no drawing. Renderers (src/render/) read a
// passenger's x, y, typeKey, type, state, animationSeconds, isCheckingPhone()
// and secondsSinceBoarded, and never change them.

class Passenger {
  // x, y: spawn point (feet position). waitX, waitY: the spot on the platform in
  // front of targetDoorIndex where they stand if that door is closed.
  constructor({ typeKey, x, y, targetDoorIndex, waitX, waitY }) {
    this.typeKey = typeKey;
    this.type = PASSENGER_TYPES[typeKey];
    this.x = x;
    this.y = y;
    this.targetDoorIndex = targetDoorIndex;
    this.waitX = waitX;
    this.waitY = waitY;
    this.state = PASSENGER_STATE.RUNNING;
    // Random start so a crowd doesn't flail its arms in perfect sync.
    this.animationSeconds = Math.random() * 10;
    // Phone Guy only: while > 0 he's standing still staring at his phone (AC 18).
    this.phoneStopSecondsLeft = 0;
    // Counts up after boarding so renderers can animate the hop into the train.
    this.secondsSinceBoarded = 0;
  }

  isCheckingPhone() {
    return this.phoneStopSecondsLeft > 0;
  }

  get passengerRunSpeed() {
    return CONFIG.commuterRunSpeed * this.type.speedMultiplier;
  }

  isOnPlatform() {
    return this.state !== PASSENGER_STATE.BOARDED;
  }

  // For renderers: on the platform, or still mid-hop through the doors.
  isVisible() {
    return this.isOnPlatform() || this.secondsSinceBoarded < CONFIG.boardingAnimationSeconds;
  }

  markLeftBehind() {
    this.state = PASSENGER_STATE.LEFT_BEHIND;
    this.phoneStopSecondsLeft = 0;
  }

  // Advances one frame. `door` is this passenger's target Door.
  // Returns true on the frame this passenger boards, so the round can score it.
  update(dt, door) {
    this.animationSeconds += dt;
    if (this.state === PASSENGER_STATE.BOARDED) {
      this.secondsSinceBoarded += dt;
      return false;
    }

    if (this.state === PASSENGER_STATE.RUNNING && this.type.stopsForPhone) {
      if (this.isCheckingPhone()) {
        this.phoneStopSecondsLeft -= dt;
      } else if (Math.random() < CONFIG.phoneStopChancePerSecond * dt) {
        const { phoneStopMinSeconds, phoneStopMaxSeconds } = CONFIG;
        this.phoneStopSecondsLeft = phoneStopMinSeconds + Math.random() * (phoneStopMaxSeconds - phoneStopMinSeconds);
      }
    }

    if (this.state === PASSENGER_STATE.RUNNING && !this.isCheckingPhone()) {
      const distanceX = this.waitX - this.x;
      const distanceY = this.waitY - this.y;
      const distanceLeft = Math.hypot(distanceX, distanceY);
      const stepDistance = this.passengerRunSpeed * dt;
      if (distanceLeft <= stepDistance) {
        this.x = this.waitX;
        this.y = this.waitY;
        this.state = PASSENGER_STATE.WAITING;
      } else {
        this.x += (distanceX / distanceLeft) * stepDistance;
        this.y += (distanceY / distanceLeft) * stepDistance;
      }
    }

    // Reaching an open (or still-closing) door boards immediately (AC 5, 14);
    // someone waiting at a closed door boards the moment it opens (AC 6).
    if (this.state === PASSENGER_STATE.WAITING && door.canBoard()) {
      this.state = PASSENGER_STATE.BOARDED; // renderers animate the hop in from here
      return true;
    }
    return false;
  }
}
