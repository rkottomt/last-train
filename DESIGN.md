# Last Train: design review and revised design

SPEC.md is the original brief and is left unchanged. This document covers two things:

- **What's wrong with the current rules:** a design critique, a bot simulation of 300 shifts per strategy, and research on what makes short arcade and time-management games fun.
- **The revised design:** what to change, in order. Nothing below is built yet. It's a plan for the next person (or session) working on the game.

## 1. What's wrong now

### The numbers (bot simulation, current tuning, 300 shifts per strategy)

| Strategy | Win % | Avg score | Note |
|---|---|---|---|
| Leave the moment you can | 100% | −186 | Worst possible score |
| Mash every door, spread the 60 s delay evenly | 100% | 176 | **No door skill at all** |
| Careful door timing, spread the delay evenly | 98% | 178 | Only ~2 points better than mashing |
| Wait for everyone | 1% | 150 | Mostly runs out of delay at station 7 |

The spread between a lucky and an unlucky run with the best strategy (10th to 90th percentile) is about 20 points. That's 10 times the gap between mashing and playing well, so luck currently decides more than skill.

Under the spec's original numbers, "wait for everyone" wins 85–92% of shifts with the top score. So the original design has the same problem.

### The problems, most important first

1. **Delay costs nothing until it suddenly ends the run.** Score is +1 per boarded passenger and −1 per passenger left behind; delay never touches it. So the best play is always to spend the whole 60 s budget, about 7.5 s per station. "Wait for the runner, or leave on time?" is never a real choice, just bookkeeping until you fall off the 60 s cliff. A game over also keeps your score, so playing recklessly beats playing safe.
2. **Opening a door early never pays.** Passengers wait at a closed door for free and board instantly when it opens, with no queue. So the best play is to keep everything shut and open all four doors just before leaving. That removes the "you can't watch all four doors" tension the spec is built around. The auto-close timer and the recharge (added later, not in the spec) only punish opening early. In the sim, about 29% of passengers reach a door while it's recharging, even with near-perfect play.
3. **Passengers can't be read.** Each one picks a random door, often running past three nearer ones, from a random stairwell. Runs range from about 2 to 13 s, and Phone Guy stops without warning. Nothing on screen shows which door someone is heading for, when they'll arrive, or how many people are still on the stairs (who count as left behind).
4. **The fiction doesn't hold together.** Real operators open every door on arrival and close them to leave, and riders use whichever door is open. People waiting at a shut door while the one beside it stands open looks like a bug.
5. **Every station plays the same way.** Later stations only have more people and less time. Their bigger point totals make them look like harder levels, but they aren't.

**What already works:** Space only departs once all doors are closed, which makes departure a clear commitment. Counting people still on the stairs as left behind closes the "leave instantly" exploit. A late runner can still squeeze in while a door is closing. Each passenger type has a readable color and speed. Every number lives in one `CONFIG` object, so tuning is cheap.

## 2. What makes games like this fun

Research summary, with sources in the review notes:

- **Every choice costs something either way** (Sid Meier's "interesting decisions"). Waiting has to cost something you can see right now, not only at a cliff.
- **Speed against accuracy** (Papers, Please): rushing loses people, and waiting loses points.
- **Randomness belongs before the decision, not after it.** Show the uncertainty (who's coming, how fast, when) and let the player choose. Phone Guy freezing with no warning breaks this.
- **Warn before every threat**, about 0.5 s or more ahead.
- **Lanes, each with its own pressure** (Tapper): four doors only feel like juggling if each one can go wrong on its own.
- **Recoverable chaos** (Overcooked): a mistake should sting and be survivable. A lockout that just strands people isn't fun.
- **Reward style** (Diner Dash chains, rhythm-game "Perfect" hits): skilled players need a ceiling to chase.
- **Short runs and an instant restart** (Crossy Road).
- **Build on real-world intuition.** A London Underground door chime is about 1.75 s, and "customer holding doors" is a real logged delay cause. Players already understand both.

## 3. Revised design

Three changes to the core loop (A–C). After them the game is about two linked decisions: **when to open each door**, and **when to give up on the runner**.

### A. Every second late costs points (fixes problem 1)

- Each second past the dwell timer costs points as well as adding delay: start at **−0.5 points per second**. The rule that each extra second adds 1 s of delay (AC 10) stays.
- Departing on time (before the dwell timer hits 0) earns **+3**.
- Waiting for a runner is now a trade you can see on the spot. A runner 4 s away costs about 2 points and is worth a 2-point swing from left behind to boarded, so it's close to break-even. Waiting for a VIP is clearly worth it; waiting for a suitcase is clearly not.
- Hitting the 60 s delay limit still ends the run (AC 12), but a run that doesn't finish earns **no stars** (AC 22). Recklessness no longer beats playing safe.

### B. Opening doors at the right moment matters (fixes problem 2)

- **Boarding takes time:** about 0.35 s per person, single file through each door. A crowd at one door takes a while to load. This is not a capacity limit, which SPEC.md rules out.
- **Mood:** a passenger who runs straight through an open door boards **happy (+2)**. One who has to wait at a shut door goes **grumpy (+1)**, and their face changes as they wait. The keep-everything-shut-then-batch strategy now costs half the points.
- **Doors keep the short open window** you asked for: about 2.5 s, then they close by themselves. The window pauses while someone is stepping through, as real door sensors do.
- **The recharge lockout shrinks** from 2.5 s to about 0.5 s (enough to stop key-mashing) or goes entirely. Its only job now is to stop a door being held open by spamming its key.
- **Juggling** now comes from four doors, each opening for a short window, with arrivals that are easy to read. Open each door just as its runners arrive.

### C. Passengers you can read (fixes problems 3 and 4)

- **Pick the nearest door,** with a small random wobble, instead of a random one.
- **A small door-number tag** over each runner, plus a ring that shrinks to show their arrival time.
- **A "still coming: N" counter** at each stairwell.
- **Phone Guy raises his phone about 0.5 s before he stops.** He still stops for 1–2 s (AC 18).
- **Door Blocker gets counterplay:** close his door before he's within reach and he can't block it. The rest of his behavior is unchanged (AC 17).

### D. Reward skill (after A–C)

- **Just made it:** a runner who boards while a door is closing gets **+1 and a pop**. Consecutive ones within a station build a **×2, ×3 chain**.
- **Per-station par:** the summary shows your score against a par target. Stars (AC 22) come from the total against the summed par.
- **R restarts instantly** from any screen.

### E. Make stations different (after A–D)

Give each station one twist, announced on the arrival sign:

| Station | Twist |
|---|---|
| 3 | One stairwell closed: everyone comes from two sides |
| 5 | Door 2 out of service |
| 7 | Rush surge: half the crowd arrives in the last third of the dwell |
| 8 | Last train: anyone left behind counts double |

### Spec impact

- **AC 5:** a passenger's point value now depends on their mood.
- **AC 4:** the "assigned" door is now the nearest one.

No other acceptance criterion changes, and nothing here touches the spec's out-of-scope list: no capacity limit, no passengers inside the train, one train.

## 4. Build order and how to check it

1. **A** in `src/round.js` (`finish()` and the delay cost) and `src/main.js` (no stars on game over).
2. **B**: a boarding queue and mood in `src/passenger.js`; door timing in `src/train.js` and `CONFIG`.
3. **C**: nearest-door targeting in `round.js` `spawnDuePassengers`; door tags, arrival rings and stairwell counters in both renderers; the Phone Guy wind-up in `passenger.js`.
4. **D**, then **E** (per-station twists as fields on `STATIONS` in `src/station.js`).

After each step, re-run the bot simulation. Its scripts are in the session scratchpad: `sim/sim.js`, with policies for mashing, careful timing, waiting for everyone and spreading the delay budget. The design is working when:

- Careful door timing beats mashing by **more than** the 10th–90th percentile luck spread. Today it's 2 points against 20.
- "Wait for everyone" and "leave immediately" both score clearly below a balanced strategy.
- The best strategy wins about 70–90% of shifts, not 100%.

These numbers only show the rules aren't broken. Whether the game is fun still needs people to play it; nobody has yet.
