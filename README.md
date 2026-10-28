# Last Train

A subway door-juggling game in plain JavaScript + HTML5 Canvas, built from [SPEC.md](SPEC.md).
You run a train through 8 stations, opening and closing 4 doors to get people aboard
without falling more than 60 s behind schedule.

## How to run

Open `index.html` in a browser. There's no build step, no server and nothing to install.

The world is drawn in **3D with WebGL2**. If WebGL2 is unavailable, or the GPU context is lost
mid-game, the game falls back to a 2D canvas renderer automatically. A small badge in the
bottom-right corner shows which one is running.

Tested in Chrome 156 and Brave 1.98 on macOS, using scripted headless runs (see "How it was
tested"). Firefox and Safari were **not** tested.

## Controls

| Key | Action |
|---|---|
| `1` `2` `3` `4` | Open / close that door. Doors close by themselves after 3 s, then recharge for 2 s; the bar above each door shows the time left |
| `Space` | Depart (only when all 4 doors are fully closed) |
| `Enter` | Start / next station / restart |
| `P` | Not implemented yet (see AC 23) |

## Acceptance criteria status

Met = implemented, and its behavior checked with scripted browser runs. **No human has played
a full shift yet**, so balance and feel are unverified.

| # | Criterion | Status |
|---|---|---|
| 1 | Title screen, Enter starts, no console errors | Met (Chrome and Brave; Firefox untested) |
| 2 | 4 distinct doors labeled 1–4 | Met |
| 3 | Keys 1–4 toggle only their door | Met |
| 4 | Passengers spawn over time, head to their door | Met |
| 5 | Board at an open door, score += points | Met |
| 6 | Wait at a closed door, board when it opens | Met |
| 7 | Space only departs with all doors closed | Met (shows "Close all doors first!") |
| 8 | Left behind −1 each, −3 VIP | Met (see the rule change in "Corners cut and decisions") |
| 9 | HUD: station, dwell, delay, score | Met |
| 10 | Each second past dwell adds 1 s of delay | Met (continuous, not whole seconds) |
| 11 | Summary after each departure, Enter continues | Met |
| 12 | 60 s delay → game over; station 8 → shift complete; Enter restarts | Met |
| 13 | Sprinter 2×, Luggage 0.5×, distinct colors | Met |
| 14 | ~0.5 s close animation; arrivals mid-close still board | Met |
| 15 | More passengers and less dwell each station | Met: exactly the spec's numbers (8→29 passengers, 15→8 s). Whether station 8 is actually impossible to fully board is unverified |
| 16 | VIPs from station 2, +5 | Met (exactly one VIP per station from station 2) |
| 17 | Door Blocker forces closing door open, 2 s key lock | Met (door shows HELD) |
| 18 | Phone Guy stops 1–2 s at random | Met |
| 19 | Announcements: door closing, delay starting, Blocker | Met (also "VIP spotted" and "Next stop") |
| 20 | Left-behind passengers react | Met: they slump with sad faces as the train pulls out. Boarding passengers hop into the door |
| 21 | Station names in HUD | Met |
| 22 | 1–3 star rating | **Not met**: `TODO(AC 22)` in `src/ui.js` |
| 23 | P pauses / resumes | **Not met**: the key is mapped in `input.js` but ignored; `TODO(AC 23)` in `src/main.js` |
| 24 | Sound effects | **Not met**: `TODO(AC 24)` in `src/train.js` |
| 25 | Best score persists | **Not met**: `TODO(AC 25)` in `src/ui.js` |

## Code map

The game is three layers. Each layer only talks to the next through one plain object, built
fresh every frame:

```
game logic ──view──▶ world renderer (draws train/platform/people)
           ──uiState──▶ UI (HUD, screens, text)
```

| File | Responsibility |
|---|---|
| `index.html` | The 16:9 stage (world canvas + UI layer) and the script tags. **Load order matters.** |
| `src/config.js` | `CONFIG`: every tunable number, each with a comment explaining why |
| `src/input.js` | Maps keys to actions (`toggleDoor`, `depart`, `confirm`, `pause`) and queues them |
| `src/train.js` | `Door` state machine (closed / open / closing, Blocker lock) and `Train` (4 doors) |
| `src/passenger.js` | `PASSENGER_TYPES` table (6 types) and `Passenger` (running → waiting → boarded / left behind) |
| `src/station.js` | `STATIONS`: 8 named stations built from the difficulty rule |
| `src/round.js` | `StationRound`: one station's live state, i.e. spawning, boarding, dwell/delay, Blockers, announcements, `finish()` |
| `src/main.js` | Game loop, state machine (title → arriving → station → departing → summary → … / gameover / shiftcomplete), shift totals, renderer choice, builds `view` and `uiState` |
| `src/render/webgl.js` | **3D renderer (WebGL2), used by default.** Instanced cubes and spheres, soft lighting + ACES tone mapping, contact shadows, door light pools, procedurally animated passengers with faces. Tunables in `GL_TUNING` / `GL_PALETTE_HEX` at the top |
| `src/render/canvas2d.js` | 2D fallback renderer. Its header documents the **renderer interface** and the `view` object |
| `src/ui.js`, `src/ui.css` | HTML/CSS UI. The header of `ui.js` documents the **`uiState` contract** |

Logic files never draw, and renderers and the UI never change game state.

How to add things:

- **New passenger type:** add an entry to `PASSENGER_TYPES`.
- **New screen:** add an entry to `GAME_STATES`, plus a case in the UI.
- **New tunable:** add it to `CONFIG`.

## Next steps (priority order)

1. **Playtest a full shift and tune `CONFIG`.** This hasn't been done. Check that station 8 really can't be fully boarded and that the 60 s delay limit creates pressure. Keeping all doors open may be close to a dominant strategy, since only the Door Blocker punishes it.
2. **Pause (AC 23).** About 10 lines: a flag in `main.js` that skips `update()`. Every timer advances by `dt`, so they all stop.
3. **Star rating (AC 22)** on the shift-complete screen, with thresholds in `CONFIG` chosen after playtesting.
4. **Best score in localStorage (AC 25)** and **sounds (AC 24)**. The hook points are marked `TODO(AC n)`.
5. **3D polish (optional):** real shadow maps (the train casts none yet), and station-name signs in the 3D scene (the name is only in the HUD).

## Known bugs and traps

- **Script order:** the files are classic `<script>` tags sharing globals, not ES modules, because `import` is blocked on pages opened from `file://`. A file can only use globals from files above it in `index.html`.
- **One canvas, one context type:** a canvas can only ever have one context type. The 2D fallback therefore always gets a fresh `<canvas>` (`switchToCanvas2D()` in `main.js`).
- **Door transitions:** the sliding-door screen transition hides the first ~0.5 s of the train's arrival animation.
- **Small windows:** UI text gets very small (about 5 px) in windows narrower than ~500 px, because the UI scales with the stage.
- **Game over:** hitting 60 s delay ends the game instantly mid-station, with no departure animation.
- **Display rounding:** the delay can overshoot 60 s by one frame internally; it displays as 60.
- **"Operator #0451"** on the end screens is a made-up flavor label.
- **Camera framing:** the 3D camera is tuned for the 16:9 stage. The HTML announcement banner sits just above the door numbers, so if you move the camera (`GL_TUNING`), keep the door numbers below about 20% of the screen height.

## Corners cut and decisions

- **People still on the stairs count as left behind** when you depart, not only people on the platform. Otherwise leaving the instant the train arrives would cost nothing. The summary shows how many "never made it off the stairs".
- **Exactly one VIP per station** from station 2, instead of random. A random draw sometimes gave zero, which conflicts with AC 16's "most stations have at least one".
- **Opening a door is instant; only closing takes 0.5 s** (spec step 5).
- **Door timer and cooldown (added on request, not in the spec):** an open door closes by itself after `CONFIG.doorOpenSeconds` (3 s). Once closed, it can't be reopened for `CONFIG.doorCooldownSeconds` (2 s); pressing its key flashes "Door N recharging". Keys are also ignored while a door is closing, so it can't be kept open forever. A bar above each door shows the time left: green while open, orange while recharging. A Blocker-held door pauses its timer until the hold ends.
- **The dwell timer starts after the train finishes pulling in** (1.4 s arrival animation), so the animations never cost delay.
- **Numbers added on top of the spec** (all in `CONFIG`, none of the spec's own numbers changed):

  | Setting | Value |
  |---|---|
  | Commuter speed | 110 px/s |
  | Spawn window | 85% of dwell |
  | Blocker reach | 80 px (≈1.2 door widths) |
  | Phone Guy stop chance | 0.4 per second |
  | Announcement duration | 2.2 s |

- **P3 features cut:** pause, stars, sound and best score, following the spec's cut order. Announcements, station names and reactions were kept.
- **3D renderer kept small:** it's one file with no shadow maps, no textures and no post-processing pass. Tile and concrete patterns are done in the shader, and door numbers are built from little glowing cubes, so the page still runs from `file://` with no assets. WebGL2 was chosen over WebGPU because WebGPU isn't on by default in Brave.

## How it was tested

Scripted runs in headless Chrome and headless Brave, driven over the DevTools protocol:

- **What the scripts did:** pressed keys, fast-forwarded time through `game.round.elapsedSeconds`, placed test passengers, checked state with `eval`, and took screenshots.
- **What was checked:** the whole loop (doors, boarding, the depart warning, summary, game over at 60 s, shift complete, restart) passed with zero console errors in both browsers. Door Blocker, Phone Guy, VIP and announcements were each checked on their own. The 3D renderer
ran at a steady 60 fps (16.7 ms median frame) in headless Brave. Both 2D fallback paths were
checked: WebGL2 unavailable, and the context lost mid-game.

The test script itself is not in the repo.
