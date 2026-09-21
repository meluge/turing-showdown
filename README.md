# turingshowdown

A counter machine that runs as a Pokémon battle — on the real
[Pokémon Showdown](https://github.com/smogon/pokemon-showdown) engine, not a model of it.

Counters are stat stages, the program counter is which Pokémon is active, and a jump is
Baton Pass. The demo computes 5! = 120 as a Defense stage of +114, in 280 turns.

```
$ node src/cli.ts factorial 5
     1 SETUP    Superpower    atk=-1 def=-1
   ...
    15 MOVE_2   Superpower    atk=-6 def=-6 spe=-6     failed: atk
    16 MOVE_2   Flame Charge  atk=-6 def=-6 spe=-5
    17 MOVE_2   Superpower    atk=-6 def=-6 spe=-5     failed: atk,def     <- R is zero: jump
    18 MOVE_2   Baton Pass    atk=-6 def=-6 spe=-5
   ...
   280 MUL_5    Hammer Arm    atk=-6 def=114 spe=-6    failed: spe

halted after 280 turns
  R = 120   (def stage 114)
```

## Quick start: factorial of 5

```
git clone https://github.com/meluge/turing-showdown.git
cd turing-showdown
scripts/setup.sh                       # once: fetch, patch and build Showdown
node src/cli.ts factorial 5            # turn-by-turn log, ends with R = 120
```

Add `--quiet` for just the result, or `--viz out/factorial5-viz.html` to write a page
that plays the run back step by step.

## Setup

Needs Node ≥ 23.6 (runs the TypeScript directly) and git.

```
scripts/setup.sh     # fetch Showdown at the pinned commit, apply the patch, build
npm test
node src/cli.ts factorial 5
node src/cli.ts collatz 27 --quiet          # 304,781 turns
node src/cli.ts run examples/multiply.cm
node src/cli.ts factorial 5 --team          # the compiled team, in Showdown's export format
node src/cli.ts factorial 5 --quiet --replay out/factorial5.html
node src/cli.ts factorial 5 --quiet --viz out/factorial5-viz.html   # the run as a counter machine
```

## The generalized game

A real battle has finitely many states, so it is a finite automaton. The construction
changes the rules in three places. Each is a format rule added by
[patches/generalized-rules.patch](patches/generalized-rules.patch) (63 changed
lines); with the rules off, the engine is unchanged and Showdown's own 2193 simulator
tests still pass.

| Rule | Change |
|---|---|
| Unbounded Boosts Mod (G1) | Stat stages have no upper bound. The −6 floor stays. The multiplier stays (2+n)/2. |
| Infinite PP Mod (G2) | Moves never lose PP. |
| No Turn Limit Mod | Removes Showdown's auto-tie at turn 1000. This is a server rule, not a game mechanic, but a long computation hits it. |

Battles run in `gen9customgame` with those rules. Custom Game also does not enforce team
size or Species Clause, which the construction needs: one Pokémon per basic block.

Accuracy and evasion stages are stored unbounded too, but their effect on hit chance
still saturates at ±6. Nothing here uses them.

## How it works

**Data.** `R` = Def stage + 6 and `T` = Spe stage + 6, on the active Pokémon. A battle
starts with stages at 0, so both counters start at 6.

| IR | Move | Effect on the user |
|---|---|---|
| `INC R` | Harden | def +1 |
| `INC T` | Flame Charge | spe +1 |
| `DEC R`, `DJZ R L` | Superpower | atk −1, def −1 |
| `DEC T`, `DJZ T L` | Hammer Arm | spe −1 |
| `GOTO L`, and the jump of `DJZ` | Baton Pass | switch to L's carrier; stages carry over |

**Zero test.** A stat at −6 cannot be lowered. The move still takes its turn, and nothing
changes. Showdown prints no "won't go any lower" message for a move's own self-drop, so
what the player sees is the *absence* of the `-unboost` line. That is the zero signal.
Superpower's Atk drop is a bystander: after setup Atk sits at −6 and fails every time,
while the Def drop succeeds or fails on its own.

**Control.** Each basic block is one carrier Pokémon, nicknamed after its label, knowing
exactly the moves its block uses (at most 4; the compiler rejects a block that needs
more). Every carrier is a level 1 Smeargle, because Sketch makes any moveset legal. Moving
to another block costs one turn of Baton Pass. Looping to the top of the current block is
free, and so is halting.

**The wall.** P2 is a Machamp with No Guard, Leftovers, and only Rest. No Guard makes
every move against it hit. That matters: Hammer Arm is 90% accurate, and a miss skips the
self-drop, which would look exactly like a zero. A level 1 attacker does 1–2 HP per hit, crits
included, which Leftovers heals the same turn. The runner checks after every turn that the wall is
within one Leftovers tick of full HP and that no carrier has been damaged. Should a move
miss anyway, the controller sees the `-miss` line and repeats the instruction.

**No cheating.** The controller ([src/runner.ts](src/runner.ts)) decides every branch
from the protocol lines that the battle shows P1. Hidden stage values are read only to
fill in the log and to check invariants. With `blind: true` it reads none at all while
running, and the tests check that it computes the same result.

## Layout

```
patches/generalized-rules.patch   the three rules, against the pinned Showdown commit
scripts/setup.sh                  fetch + patch + build Showdown into ./pokemon-showdown
src/ir.ts                         INC / DEC / DJZ / GOTO / HALT, validation, text form
src/interp.ts                     reference interpreter on plain integers, same turn accounting
src/compile.ts                    IR -> carriers and movesets, 4-move limit
src/battle.ts                     the Showdown battle: teams, choices, P1's view of the protocol
src/runner.ts                     the controller
src/programs.ts                   factorial(n), collatz(n)
src/cli.ts
src/viz.ts, src/viz.html          --viz: an offline page that plays a run back as a counter machine
test/engine.test.ts               the mechanics, checked on the real engine, with stock-rule controls
test/factorial.test.ts            n = 0..6; n = 5 gives def +114, 280 turns, the exact move sequence
test/costs.test.ts                per-block turn costs
test/runner.test.ts               blind run, collatz, 4-move limit, 150 random programs vs. the interpreter
```

## Differences from the handoff spec

- **Showdown is the engine, not a stretch goal.** There is no separate toy simulator. The
  plain-integer interpreter in `src/interp.ts` is the oracle the battle is tested against.
- **The 280 turns are made up differently.** The spec counts setup as 13 turns flowing
  straight into `MOVE`, plus a final Baton Pass: 13 + 267. But setup needs Superpower,
  Hammer Arm and Harden, and `MOVE` needs Flame Charge and Baton Pass: five moves. So
  setup is its own carrier and passes to `MOVE_2` (14 turns), and the last block halts
  without passing (266 turns). The total is still 280, and the per-block formulas hold:
  `MOVE_k` costs 2n+2, `MUL_k` costs n(k+1)+2, one less for the last.
- **One carrier per block**, so `MOVE` and `MUL` are instantiated per `k` and the
  controller tracks nothing but its place in the current block. factorial(5) is a team of 9.
- **`DEC`** (decrement, ignore the result) is added to the IR so setup is ordinary code.
- **No Guard instead of Battle Armor** on the wall. See above: misses break the zero
  test, while crits from a level 1 attacker are harmless (the tests see crits happen
  and the HP invariant hold).
- **The turn-1000 auto-tie** had to go as well. factorial(6) takes 1364 turns.

The spec's mechanic assumptions 1–3 hold on the real engine as stated. 4 and 5 hold for
the wall used here: chip damage stays under Leftovers recovery (crits are allowed and
harmless), and a wall that only knows Rest never affects P1. `test/engine.test.ts` checks
each one.

## Not done

- The engine-driven zero-test gadget that an undecidability proof needs. Here the player
  reads the battle log and chooses the branch.
- Dropping G2 with a Leppa Berry + Recycle loop.
- The HTML replay (`--replay`) follows the format of a replay downloaded from Showdown and
  loads Showdown's viewer script, but has not been opened in a browser. The viewer may
  not display stages above +6 sensibly.
