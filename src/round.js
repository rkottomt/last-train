// StationRound: the live state of ONE station visit. main.js creates a new one
// each time the train pulls in and throws it away after departure, so nothing
// leaks between stations. A round knows nothing about the rest of the shift
// (total score, total delay); main.js combines the round's numbers with the
// shift totals.

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
    this.happyCount = 0; // boarded without ever being stuck at a shut door
    this.pointsEarned = 0; // from boarding only; penalties are applied at departure
    this.emptyDoorCycles = 0; // doors opened and shut with nobody boarding
    // Announcement texts waiting for main.js to show (AC 19). A queue, so the
    // round never needs to know how or where announcements are drawn.
    this.pendingAnnouncements = [];
  }

  announce(text) {
    this.pendingAnnouncements.push(text);
  }

  drainAnnouncements() {
    const announcements = this.pendingAnnouncements;
    this.pendingAnnouncements = [];
    return announcements;
  }

  // Counts down from the station's dwell time. Goes negative once the train is
  // running late; the HUD shows that as "+Ns late".
  dwellSecondsLeft() {
    return this.station.dwellSeconds - this.elapsedSeconds;
  }

  // Every second at the station past the scheduled dwell is a second of delay
  // (AC 10). Continuous, not whole seconds, so the 60 s limit triggers exactly.
  delayAddedSeconds() {
    return Math.max(0, this.elapsedSeconds - this.station.dwellSeconds);
  }

  // Returns false if the door ignored the press (held, closing or recharging).
  toggleDoor(doorIndex) {
    const door = this.train.doors[doorIndex];
    const accepted = door.toggle();
    if (accepted && door.state === DOOR_STATE.CLOSING) this.announce('Stand clear of the closing doors!');
    return accepted;
  }

  canDepart() {
    return this.train.allDoorsClosed();
  }

  // Points lost to running late so far: 1 per CONFIG.latePenaltySecondsPerPoint.
  latePenaltyPoints() {
    return Math.floor(this.delayAddedSeconds() / CONFIG.latePenaltySecondsPerPoint);
  }

  // The round's score as it stands right now (the HUD shows this live, so the
  // player watches lateness eat into it): boarding points minus the late cost.
  livePoints() {
    return this.pointsEarned - this.emptyCyclePenaltyPoints() - this.latePenaltyPoints();
  }

  emptyCyclePenaltyPoints() {
    return this.emptyDoorCycles * CONFIG.emptyDoorCyclePenaltyPoints;
  }

  // Best possible score here: everyone boards happy and you leave on time.
  perfectPoints() {
    const boardingMax = this.spawnSchedule.reduce((sum, entry) => sum + PASSENGER_TYPES[entry.typeKey].points + CONFIG.happyBonusPoints, 0);
    return boardingMax + CONFIG.onTimeBonusPoints;
  }

  // Ends the station and returns its numbers for the summary screen and the shift
  // totals. Everyone not on the train is left behind (AC 8), INCLUDING people who
  // hadn't reached the bottom of the stairs yet. Without that, leaving the instant
  // the train arrives would be a free, penalty-free strategy.
  finish() {
    const leftOnPlatform = this.passengers.filter((passenger) => passenger.isOnPlatform()).map((p) => p.typeKey);
    const stillOnStairs = this.spawnSchedule.slice(this.nextSpawnIndex).map((entry) => entry.typeKey);
    const leftBehindTypeKeys = [...leftOnPlatform, ...stillOnStairs];
    const penaltyPoints = leftBehindTypeKeys.reduce((sum, typeKey) => sum + PASSENGER_TYPES[typeKey].leftBehindPenalty, 0);
    const latePenaltyPoints = this.latePenaltyPoints();
    const onTimeBonusPoints = this.delayAddedSeconds() === 0 ? CONFIG.onTimeBonusPoints : 0;
    // Renderers show these people slumping sadly as the train pulls out (AC 20).
    for (const passenger of this.passengers) {
      if (passenger.isOnPlatform()) passenger.markLeftBehind();
    }
    return {
      stationNumber: this.station.number,
      stationName: this.station.name,
      boardedCount: this.boardedCount,
      happyCount: this.happyCount,
      leftBehindCount: leftBehindTypeKeys.length,
      leftOnStairsCount: stillOnStairs.length,
      pointsEarned: this.pointsEarned,
      penaltyPoints,
      latePenaltyPoints,
      onTimeBonusPoints,
      emptyDoorCycles: this.emptyDoorCycles,
      emptyCyclePenaltyPoints: this.emptyCyclePenaltyPoints(),
      perfectPoints: this.perfectPoints(),
      netPoints: this.livePoints() - penaltyPoints + onTimeBonusPoints,
      delayAddedSeconds: this.delayAddedSeconds(),
    };
  }

  update(dt) {
    const wasOnTime = this.delayAddedSeconds() === 0;
    this.elapsedSeconds += dt;
    if (wasOnTime && this.delayAddedSeconds() > 0) this.announce('We are being held momentarily...');
    this.train.update(dt);
    for (const door of this.train.doors) {
      if (!door.hasFinishedEmptyCycle) continue;
      door.hasFinishedEmptyCycle = false;
      this.emptyDoorCycles += 1;
      this.announce(`Door ${door.label} opened for nobody`);
    }
    this.spawnDuePassengers();

    this.applyDoorBlockers();

    for (const passenger of this.passengers) {
      const points = passenger.update(dt, this.train.doors[passenger.targetDoorIndex]);
      if (points > 0) {
        this.boardedCount += 1;
        if (passenger.boardedHappy) this.happyCount += 1;
        this.pointsEarned += points;
        if (passenger.boardedJustInTime) this.announce('Just made it!');
      }
    }
  }

  // After departure the round's rules are frozen, but the people left on the
  // platform keep animating (slumping sadly) while the train pulls away.
  updateAnimationsOnly(dt) {
    for (const passenger of this.passengers) passenger.animationSeconds += dt;
  }

  // AC 17: a door that is closing with a Door Blocker near its doorway pops back
  // open and ignores its key for CONFIG.blockerDoorLockSeconds. Checked every
  // frame of the close, so a Blocker who arrives mid-animation also counts.
  applyDoorBlockers() {
    const { platformTop } = CONFIG.layout;
    for (const door of this.train.doors) {
      if (door.state !== DOOR_STATE.CLOSING) continue;
      const blockerIsNear = this.passengers.some(
        (passenger) =>
          passenger.isOnPlatform() &&
          passenger.type.blocksClosingDoors &&
          Math.hypot(passenger.x - door.centerX, passenger.y - platformTop) <= CONFIG.blockerReachPixels,
      );
      if (blockerIsNear) {
        door.forceOpenByBlocker();
        this.announce(`Someone is holding door ${door.label}!`);
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

      // The door nearest their stairwell, give or take a wobble, so people spread
      // over all four doors but never run past three nearer ones.
      const stairwellX = pickRandom(stairwellCenterXs);
      const aimX = stairwellX + randomBetween(-CONFIG.doorChoiceWobblePixels, CONFIG.doorChoiceWobblePixels);
      const doors = this.train.doors;
      const door = doors.reduce((best, candidate) => (Math.abs(candidate.centerX - aimX) < Math.abs(best.centerX - aimX) ? candidate : best));
      const targetDoorIndex = door.index;
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
      if (typeKey === 'vip') this.announce(`VIP spotted heading for door ${door.label}!`);
    }
  }
}
