// The opening shot's timeline (CONFIG.intro): where the train is at each moment
// of the intro, as a pure function of time. main.js uses it to place the train;
// the 3D renderer uses it to know where the cab is when its camera leaves it.
//
// The train cruises, then brakes to a smooth stop exactly at the end of the shot.
// While braking, speed = cruiseSpeed * (1 - u)^1.5 (u: 0 -> 1 over the braking
// phase), which reaches zero with zero deceleration, so the stop doesn't jolt.
// Integrating it gives the distance-left formula in trainOffsetPixels().

const IntroTimeline = {
  brakeSeconds() {
    return CONFIG.intro.seconds - CONFIG.intro.brakeStartSeconds;
  },

  // Distance covered while braking: integral of (1 - u)^1.5 is 1 / 2.5.
  brakeDistancePixels() {
    return (CONFIG.intro.cruiseSpeed * this.brakeSeconds()) / 2.5;
  },

  // How far (layout pixels) the train still is from its docked spot.
  trainOffsetPixels(seconds) {
    const { cruiseSpeed, brakeStartSeconds } = CONFIG.intro;
    if (seconds < brakeStartSeconds) {
      return this.brakeDistancePixels() + cruiseSpeed * (brakeStartSeconds - seconds);
    }
    const u = Math.min(1, (seconds - brakeStartSeconds) / this.brakeSeconds());
    return this.brakeDistancePixels() * Math.pow(1 - u, 2.5);
  },

  // 1 at cruising speed, 0 when stopped (drives the cab's speed gauge).
  speedFraction(seconds) {
    const { brakeStartSeconds } = CONFIG.intro;
    if (seconds < brakeStartSeconds) return 1;
    const u = Math.min(1, (seconds - brakeStartSeconds) / this.brakeSeconds());
    return Math.pow(1 - u, 1.5);
  },
};
