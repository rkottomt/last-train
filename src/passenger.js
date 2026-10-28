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
//   carriesBox, sparkles - optional drawing extras (see Passenger.draw)

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
  // TODO(AC 18): Phone Guy (blue, normal speed, stops 1-2 s at random, from station 3).
  // TODO(AC 17): Door Blocker (orange, forces closing doors back open, from station 4).
};

const PASSENGER_STATE = {
  RUNNING: 'running', // heading for their door's waiting spot
  WAITING: 'waiting', // at the door, which is closed; will board the moment it opens
  BOARDED: 'boarded', // on the train; no longer drawn or updated
};

const PASSENGER_LOOK = {
  skin: '#f1c9a5',
  limbs: '#2b2b2b',
  bodyWidth: 14,
  bodyHeight: 20,
  legLength: 12,
  headRadius: 7,
};

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
  }

  get passengerRunSpeed() {
    return CONFIG.commuterRunSpeed * this.type.speedMultiplier;
  }

  isOnPlatform() {
    return this.state !== PASSENGER_STATE.BOARDED;
  }

  // Advances one frame. `door` is this passenger's target Door.
  // Returns true on the frame this passenger boards, so the round can score it.
  update(dt, door) {
    this.animationSeconds += dt;

    if (this.state === PASSENGER_STATE.RUNNING) {
      // TODO(AC 18): Phone Guy. If this.type stops for his phone, keep a
      // `phoneStopSecondsLeft` timer: while it's > 0, count it down and skip the
      // movement below; otherwise roll a small per-second chance to start a 1-2 s stop.
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
      this.state = PASSENGER_STATE.BOARDED;
      // TODO(AC 20): happy bounce / little cheer on boarding would start here.
      return true;
    }
    return false;
  }

  draw(ctx) {
    const look = PASSENGER_LOOK;
    const isRunning = this.state === PASSENGER_STATE.RUNNING;
    // Waiting passengers hop impatiently in place (AC 6: "visibly impatient").
    const hop = isRunning ? 0 : Math.abs(Math.sin(this.animationSeconds * 7)) * 3;
    const feetY = this.y - hop;
    const hipY = feetY - look.legLength;
    const shoulderY = hipY - look.bodyHeight + 4;
    const headY = hipY - look.bodyHeight - look.headRadius + 1;

    // Legs scissor and arms flail while running; faster types flail faster.
    const swingSpeed = 10 * this.type.speedMultiplier;
    const swing = isRunning ? Math.sin(this.animationSeconds * swingSpeed) : 0;

    ctx.strokeStyle = look.limbs;
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(this.x, hipY);
    ctx.lineTo(this.x - 3 + swing * 6, feetY);
    ctx.moveTo(this.x, hipY);
    ctx.lineTo(this.x + 3 - swing * 6, feetY);
    ctx.stroke();

    ctx.fillStyle = this.type.color;
    ctx.fillRect(this.x - look.bodyWidth / 2, hipY - look.bodyHeight, look.bodyWidth, look.bodyHeight);

    // Arms, mirrored left/right. armAngle is radians away from hanging straight
    // down: wild flapping while running, raised and waving while waiting.
    const armLength = 12;
    const armAngle = isRunning ? 1.2 + swing : 2.4 + Math.sin(this.animationSeconds * 9) * 0.3;
    const armReachX = Math.sin(armAngle) * armLength;
    const armReachY = Math.cos(armAngle) * armLength;
    ctx.beginPath();
    ctx.moveTo(this.x - look.bodyWidth / 2, shoulderY);
    ctx.lineTo(this.x - look.bodyWidth / 2 - armReachX, shoulderY + armReachY);
    ctx.moveTo(this.x + look.bodyWidth / 2, shoulderY);
    ctx.lineTo(this.x + look.bodyWidth / 2 + armReachX, shoulderY + armReachY);
    ctx.stroke();

    ctx.fillStyle = PASSENGER_LOOK.skin;
    ctx.beginPath();
    ctx.arc(this.x, headY, look.headRadius, 0, Math.PI * 2);
    ctx.fill();

    if (this.type.carriesBox) {
      // A big cardboard box hugged in front of the body.
      ctx.fillStyle = '#c99a5b';
      ctx.fillRect(this.x - 11, hipY - 15, 22, 16);
      ctx.strokeStyle = '#7a5a30';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(this.x - 11, hipY - 15, 22, 16);
      ctx.beginPath();
      ctx.moveTo(this.x - 11, hipY - 9);
      ctx.lineTo(this.x + 11, hipY - 9);
      ctx.stroke();
    }

    if (this.type.sparkles) {
      // Three little stars orbiting the head.
      ctx.fillStyle = '#fff3a0';
      for (let i = 0; i < 3; i++) {
        const angle = this.animationSeconds * 3 + (i * Math.PI * 2) / 3;
        const sparkleX = this.x + Math.cos(angle) * 16;
        const sparkleY = headY + Math.sin(angle) * 10;
        const size = 2 + Math.abs(Math.sin(this.animationSeconds * 8 + i)) * 2;
        ctx.fillRect(sparkleX - size / 2, sparkleY - size / 2, size, size);
      }
    }

    // TODO(AC 20): sad face / slump for passengers left behind as the train pulls out.
  }
}
