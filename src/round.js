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
};

class StationRound {
  constructor() {
    this.train = new Train();
  }

  toggleDoor(doorIndex) {
    this.train.doors[doorIndex].toggle();
  }

  update(dt) {
    this.train.update(dt);
  }

  draw(ctx) {
    const { platformTop, trainBottom } = CONFIG.layout;
    fillScreen(ctx, WORLD_COLORS.tunnelWall);

    this.train.draw(ctx);

    // Platform: a slab under the train with a yellow "stand behind the line" stripe.
    ctx.fillStyle = WORLD_COLORS.platformEdge;
    ctx.fillRect(0, trainBottom, CONFIG.canvasWidth, platformTop - trainBottom);
    ctx.fillStyle = WORLD_COLORS.platform;
    ctx.fillRect(0, platformTop, CONFIG.canvasWidth, CONFIG.canvasHeight - platformTop);
    ctx.fillStyle = WORLD_COLORS.safetyLine;
    ctx.fillRect(0, platformTop + 6, CONFIG.canvasWidth, 4);
  }
}
