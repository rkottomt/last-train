// StationRound: the live state of ONE station visit. main.js creates a new one
// each time the train pulls in and throws it away after departure, so nothing
// leaks between stations. A round knows nothing about the rest of the shift
// (total score, total delay); main.js combines the round's numbers with the
// shift totals.

const WORLD_COLORS = {
  tunnelWall: '#2a2d36',
  platform: '#6b6f78',
  platformEdge: '#4b4f57',
  safetyLine: '#e8c43a',
  stairwell: '#3d4048',
  stairStep: '#565a63',
};

function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

function pickRandom(items) {
  return items[Math.floor(Math.random() * items.length)];
}

function shuffleInPlace(items) {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

function pickWeightedPassengerType(allowedTypes) {
  const weighted = allowedTypes.filter((typeKey) => PASSENGER_TYPES[typeKey].spawnWeight > 0);
  const totalWeight = weighted.reduce((sum, typeKey) => sum + PASSENGER_TYPES[typeKey].spawnWeight, 0);
  let roll = Math.random() * totalWeight;
  for (const typeKey of weighted) {
    roll -= PASSENGER_TYPES[typeKey].spawnWeight;
    if (roll <= 0) return typeKey;
  }
  return weighted[weighted.length - 1];
}

// Decides who will come down the stairs at this station and when.
// Returns [{ spawnAtSeconds, typeKey }] sorted by time.
function buildSpawnSchedule(station) {
  const typeKeys = [];
  for (const typeKey of station.allowedTypes) {
    const guaranteed = PASSENGER_TYPES[typeKey].guaranteedPerStation || 0;
    for (let i = 0; i < guaranteed && typeKeys.length < station.passengerCount; i++) typeKeys.push(typeKey);
  }
  while (typeKeys.length < station.passengerCount) {
    typeKeys.push(pickWeightedPassengerType(station.allowedTypes));
  }
  shuffleInPlace(typeKeys);

  // One passenger per equal time slot, at a random moment inside that slot: arrivals
  // are spread over the whole window (AC 4) but never perfectly regular.
  const spawnWindowSeconds = station.dwellSeconds * CONFIG.spawnWindowFractionOfDwell;
  const slotSeconds = spawnWindowSeconds / typeKeys.length;
  return typeKeys.map((typeKey, slot) => ({
    spawnAtSeconds: CONFIG.firstSpawnDelaySeconds + (slot + Math.random()) * slotSeconds,
    typeKey,
  }));
}

class StationRound {
  constructor(station) {
    this.station = station;
    this.train = new Train();
    this.passengers = [];
    this.spawnSchedule = buildSpawnSchedule(station);
    this.nextSpawnIndex = 0;
    this.elapsedSeconds = 0; // time since the train pulled in
    this.boardedCount = 0;
    this.pointsEarned = 0; // from boarding only; penalties are applied at departure
  }

  // Counts down from the station's dwell time. Goes negative once the train is
  // running late; the HUD shows that as "+Ns late".
  dwellSecondsLeft() {
    return this.station.dwellSeconds - this.elapsedSeconds;
  }

  toggleDoor(doorIndex) {
    this.train.doors[doorIndex].toggle();
  }

  update(dt) {
    this.elapsedSeconds += dt;
    this.train.update(dt);
    this.spawnDuePassengers();

    // TODO(AC 17): Door Blocker. For each door that is CLOSING, if any Door Blocker
    // on the platform is within ~one CONFIG.layout.doorWidth of door.centerX (and
    // near the platform edge), force it back open and lock its key for 2 s
    // (see the TODO in Door.toggle). TODO(AC 19): announce it.

    for (const passenger of this.passengers) {
      if (!passenger.isOnPlatform()) continue;
      const boardedThisFrame = passenger.update(dt, this.train.doors[passenger.targetDoorIndex]);
      if (boardedThisFrame) {
        this.boardedCount += 1;
        this.pointsEarned += passenger.type.points;
      }
    }
  }

  spawnDuePassengers() {
    const { stairwellCenterXs, stairwellWidth, stairwellTop, platformTop, waitingAreaDepth, doorWidth } = CONFIG.layout;
    while (
      this.nextSpawnIndex < this.spawnSchedule.length &&
      this.spawnSchedule[this.nextSpawnIndex].spawnAtSeconds <= this.elapsedSeconds
    ) {
      const { typeKey } = this.spawnSchedule[this.nextSpawnIndex];
      this.nextSpawnIndex += 1;

      // Random door rather than nearest: people head for different doors, so
      // the player has to watch all four at once.
      const targetDoorIndex = Math.floor(Math.random() * this.train.doors.length);
      const door = this.train.doors[targetDoorIndex];
      const stairwellX = pickRandom(stairwellCenterXs);
      this.passengers.push(
        new Passenger({
          typeKey,
          x: stairwellX + randomBetween(-stairwellWidth / 3, stairwellWidth / 3),
          y: stairwellTop,
          targetDoorIndex,
          waitX: door.centerX + randomBetween(-doorWidth * 0.45, doorWidth * 0.45),
          waitY: platformTop + 24 + Math.random() * waitingAreaDepth,
        }),
      );
      // TODO(AC 19): announce "VIP spotted!" when typeKey === 'vip'.
    }
  }

  draw(ctx) {
    const { platformTop, trainBottom, stairwellCenterXs, stairwellWidth, stairwellTop } = CONFIG.layout;
    fillScreen(ctx, WORLD_COLORS.tunnelWall);

    this.train.draw(ctx);

    // Platform: a slab under the train with a yellow "stand behind the line" stripe.
    ctx.fillStyle = WORLD_COLORS.platformEdge;
    ctx.fillRect(0, trainBottom, CONFIG.canvasWidth, platformTop - trainBottom);
    ctx.fillStyle = WORLD_COLORS.platform;
    ctx.fillRect(0, platformTop, CONFIG.canvasWidth, CONFIG.canvasHeight - platformTop);
    ctx.fillStyle = WORLD_COLORS.safetyLine;
    ctx.fillRect(0, platformTop + 6, CONFIG.canvasWidth, 4);

    // Stairwells at the back of the platform, drawn as a stack of steps.
    for (const centerX of stairwellCenterXs) {
      const left = centerX - stairwellWidth / 2;
      ctx.fillStyle = WORLD_COLORS.stairwell;
      ctx.fillRect(left, stairwellTop, stairwellWidth, CONFIG.canvasHeight - stairwellTop);
      ctx.fillStyle = WORLD_COLORS.stairStep;
      for (let stepY = stairwellTop + 6; stepY < CONFIG.canvasHeight; stepY += 10) {
        ctx.fillRect(left + 4, stepY, stairwellWidth - 8, 4);
      }
    }

    // Draw people further up the platform first, so nearer people overlap them.
    const onPlatform = this.passengers.filter((passenger) => passenger.isOnPlatform());
    onPlatform.sort((a, b) => a.y - b.y);
    for (const passenger of onPlatform) passenger.draw(ctx);
  }
}
