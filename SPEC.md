# Last Train

*Game spec, Phase 1*

## The game

You run a subway train during the evening rush. At every station, people pour down the stairs and sprint for the doors, and you decide which of the train's four doors are open. Close one too early and someone's left on the platform with their face pressed to the glass. Hold the doors too long and you fall behind schedule. Fall too far behind and you're pulled off the line.

A shift is 8 stations. Each one is a short round of watching the crowd, juggling doors, and picking your moment to leave. **Score = people you got home minus people you left behind.**

## Why it's fun

You can't board everyone and stay on time. The game is making that call over and over: the sprinter will make it, the guy with the suitcase won't, the VIP is halfway down the stairs... do I wait? And with four doors you can't watch them all at once, so things go wrong in funny ways.

## Feel

Tense but silly, like an overworked cartoon operator. Passengers should look a bit ridiculous: arms flailing as they run, a sad face when a door shuts on them. The platform gets more crowded and frantic as the shift goes on. Short announcements pop up ("Stand clear of the closing doors!", "We are being held momentarily..."). It shouldn't feel punishing. Losing should be funny ("You've been reassigned to the depot.").

## Tech

- Plain JavaScript + HTML5 Canvas. No frameworks, no build step.
- Opening `index.html` in a browser runs the game.
- Simple shapes are fine for art: rectangles for the train, circles or stick figures for people. Color tells passenger types apart.

## How it plays

### Layout (side view)

- **Train:** runs horizontally across the middle of the screen, with 4 doors labeled 1–4 from left to right.
- **Platform:** below the train. Passengers appear from the stairs at the back.
- **HUD:** along the top. Shows station name and number (e.g. "Station 3 / 8, Craig St"), dwell timer, total delay, and score.

### Controls

| Key | Action |
|---|---|
| `1`, `2`, `3`, `4` | Open/close that door |
| `Space` | Depart (only when all doors are closed) |
| `Enter` | Start / next station / restart |
| `P` | Pause |

### A station, step by step

1. The train pulls in with all doors closed. The dwell timer starts counting down from the station's scheduled dwell time.
2. Passengers spawn at the stairs over time. Each picks a target door and runs for it.
3. If they reach an open door, they board (disappear into the train) and the score goes up.
4. If they reach a closed door, they wait there, visibly impatient, until it opens or the train leaves.
5. Doors take about 0.5 s to close, with an animation. Anyone who reaches a door while it's closing still makes it.
6. Space departs. Anyone still on the platform is left behind.
7. Once the dwell timer hits 0, every extra second at the station adds 1 s to the total delay.
8. A summary screen shows boarded / left behind / delay added. Enter goes to the next station.

### Passenger types

| Type | Look | Behavior | Points |
|---|---|---|---|
| Commuter | Gray | Normal speed | +1 |
| Sprinter | Red | Fast, about 2× a commuter | +1 |
| Luggage | Brown, carrying a box | Slow, about 0.5× a commuter | +1 |
| Phone Guy | Blue | Normal speed, but randomly stops for 1–2 s to check his phone | +1 |
| Door Blocker | Orange | If a door starts closing while he's near it, he sticks his arm in and forces it back open. That door can't close again for 2 s. | +1 |
| VIP | Gold, sparkles | Normal speed, rare (about 1 per station) | +5 |

Leaving someone behind costs 1 point. Leaving a VIP behind costs 3.

### Difficulty over the shift

Each station has more passengers and a shorter dwell than the last. Starting numbers (tune as needed):

- **Station 1:** 8 passengers, 15 s dwell, Commuters and Sprinters only.
- **Each station after:** roughly +3 passengers and −1 s dwell (minimum 8 s).
- **New types phase in:** Luggage and VIP at station 2, Phone Guy at 3, Door Blocker at 4.
- **Station 8** is a rush-hour crowd you can't fully board.

### End of shift

- **Lose:** total delay hits 60 s at any point. Show a game-over screen ("You've been reassigned to the depot.") with final stats.
- **Win:** finish all 8 stations. Show a shift-complete screen with total boarded, total left behind, total delay, final score, and a 1–3 star rating. Pick the star thresholds by playtesting.
- Enter restarts from station 1.

## Scope

### Full feature set

The whole list, even though most of it won't land in Phase 1:

- Title screen, station rounds, summary screens, game-over and shift-complete screens
- 4 independently controlled doors with a closing animation
- All 6 passenger types
- Dwell timer, cumulative delay, and score
- Difficulty ramp across 8 named stations
- Pop-up announcements for events (doors closing, delay, VIP spotted, blocker)
- Passenger reactions: sad face or slump when left behind, happy bounce when boarding
- Stretch: sound effects (door chime, "stand clear" beep)
- Stretch: high score saved in localStorage

### Out of scope

Please don't build these:

- Driving between stations (the train just leaves the screen and arrives at the next one)
- Multiple trains or lines
- Passengers inside the train, or a capacity limit
- Mobile or touch controls

## Acceptance criteria

**P1** = core, the game doesn't work without it. **P2** = makes it fun. **P3** = polish. Numbered straight through so the cut list below can refer to them.

### Core loop

1. **[P1]** Opening `index.html` in Chrome or Firefox shows a title screen. Enter starts station 1. No console errors.
2. **[P1]** The train has 4 visibly distinct doors, labeled 1–4.
3. **[P1]** Keys 1–4 toggle the matching door, and only that door.
4. **[P1]** Passengers spawn at the back of the platform over the course of the station (not all at once) and head for their assigned door.
5. **[P1]** A passenger who reaches an open door boards: they disappear and the score goes up by their point value.
6. **[P1]** A passenger who reaches a closed door stops and waits. They board if the door opens later.
7. **[P1]** Space only departs when all 4 doors are closed. Otherwise it does nothing or shows "Close all doors first!".
8. **[P1]** On departure, everyone still on the platform counts as left behind (−1 each, −3 for a VIP).
9. **[P1]** The HUD always shows station number, dwell countdown, total delay, and score.
10. **[P1]** After the dwell timer hits 0, each extra second at the station adds 1 s to total delay.
11. **[P1]** A summary screen follows each departure. Enter loads the next station.
12. **[P1]** Total delay of 60 s ends the game with a game-over screen. Finishing station 8 shows the shift-complete screen. Enter restarts from station 1 on either.

### Passengers & difficulty

13. **[P2]** Sprinters move about 2× as fast as Commuters, Luggage about 0.5×. Each type has its own color.
14. **[P2]** Doors take about 0.5 s to close, with a visible animation. Anyone arriving during the animation still boards.
15. **[P2]** Each station has more passengers and a shorter dwell than the one before, matching the difficulty section within ±20%.
16. **[P2]** From station 2 on, most stations have at least one gold VIP. Boarding one is worth +5.
17. **[P2]** From station 4 on, Door Blockers appear. If a door starts closing with a Blocker within about one door-width, it pops back open and ignores its key for 2 s.
18. **[P2]** From station 3 on, Phone Guy visibly stops mid-run for 1–2 s at random.

### Feel & polish

19. **[P3]** Announcements pop up for at least: a door closing, delay starting to build, and a Blocker forcing a door open.
20. **[P3]** Passengers left behind react visibly (sad face, slump, etc.) as the train pulls out.
21. **[P3]** Each station has a name, shown in the HUD.
22. **[P3]** The shift-complete screen shows a 1–3 star rating.
23. **[P3]** P pauses and resumes. Timers stop while paused.
24. **[P3]** Stretch: sound effects for the door chime and closing doors.
25. **[P3]** Stretch: best score persists across page reloads.

## What to cut first

1. **Get P1 working first.** One station where you toggle 4 doors, people board or get left, and you depart is already the game. Make that solid before anything else.
2. **Next, the multi-station shift with the delay / game-over rule (10–12).** That's where the pressure comes from.
3. **Then passenger speeds and the door-closing animation (13–14).** That's what makes the decisions hard.
4. **If time runs short, cut in this order:** sound (24), high score (25), pause (23), star rating (22), station names (21), Phone Guy (18), announcements (19). **Try hard to keep the Door Blocker (17) and VIP (16).** They're the funniest part.

All the numbers (speeds, dwell times, passenger counts, the 60 s limit) are starting points. Change them if it plays better, and note what you changed in the README.
