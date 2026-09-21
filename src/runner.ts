// Runs a compiled program as a battle.
//
// The controller is a player: everything it knows comes from the protocol
// lines the battle shows P1. It tells a zero counter from a nonzero one only by
// whether the lowering move produced an `-unboost` line. (Showdown prints no
// "won't go any lower" message for a move's own self-drop, so the signal is the
// missing line.) Stage values are read only to fill in the log.

import { type Program, HALT_LABEL } from './ir.ts';
import { type Carrier, type MoveSpec, type Stat, BATON_PASS, COUNTER_STAT, LOWER, RAISE, compile } from './compile.ts';
import { type Stages, GeneralizedBattle } from './battle.ts';
import type { Visit } from './interp.ts';

export interface TurnRecord {
	turn: number;
	carrier: string;
	/** index in the carrier's body of the instruction this turn belongs to */
	pc: number;
	move: string;
	/** stat changes the move attempted that did not happen */
	failed: Stat[];
	/** hidden state, for the log only; null in a blind run */
	stages: Stages | null;
}

export interface RunOptions {
	maxTurns?: number;
	seed?: number[];
	/** never read hidden state while running: no per-turn stages, no invariant checks */
	blind?: boolean;
	onTurn?: (record: TurnRecord) => void;
}

export interface RunResult {
	halted: boolean;
	turns: number;
	visits: Visit[];
	log: TurnRecord[];
	/** the active carrier's stages after the last turn */
	stages: Stages;
	battle: GeneralizedBattle;
}

interface Observation {
	raised: Set<string>;
	lowered: Set<string>;
	missed: boolean;
}

/** What P1 can see of its own active Pokémon's turn. */
function observe(lines: string[], label: string, move: string, turn: number): Observation {
	const me = `p1a: ${label}`;
	const seen: Observation = { raised: new Set(), lowered: new Set(), missed: false };
	let used = false;
	for (const line of lines) {
		const [, kind, who, what] = line.split('|');
		if (who !== me) continue;
		if (kind === 'move' && what === move) used = true;
		if (kind === '-boost') seen.raised.add(what);
		if (kind === '-unboost') seen.lowered.add(what);
		if (kind === '-miss') seen.missed = true;
	}
	if (!used) throw new Error(`turn ${turn}: ${label} did not get to use ${move}:\n${lines.join('\n')}`);
	if (!lines.includes(`|turn|${turn + 1}`)) throw new Error(`turn ${turn} did not end normally:\n${lines.join('\n')}`);
	return seen;
}

export function run(program: Program, options: RunOptions = {}): RunResult {
	const { maxTurns = Infinity, blind = false } = options;
	const carriers = new Map<string, Carrier>(compile(program).map(c => [c.label, c]));
	const battle = new GeneralizedBattle([...carriers.values()], options.seed);

	let carrier = carriers.get(program.blocks[0].label)!;
	let pc = 0;
	let at = 0;
	let turns = 0;
	const log: TurnRecord[] = [];
	const visits: Visit[] = [{ label: carrier.label, turns: 0 }];

	const endTurn = (move: string, failed: Stat[]) => {
		turns++;
		visits.at(-1)!.turns++;
		if (!blind) battle.assertInvariants();
		const record = { turn: turns, carrier: carrier.label, pc: at, move, failed, stages: blind ? null : battle.stages() };
		log.push(record);
		options.onTurn?.(record);
	};

	/** One turn of a stat move; returns what was seen, or null if the move missed. */
	const useMove = (spec: MoveSpec): Observation | null => {
		const seen = observe(battle.useMove(spec.name), carrier.label, spec.name, turns + 1);
		const failed = seen.missed ? [...spec.raises, ...spec.lowers] : [
			...spec.raises.filter(stat => !seen.raised.has(stat)),
			...spec.lowers.filter(stat => !seen.lowered.has(stat)),
		];
		endTurn(spec.name, failed);
		return seen.missed ? null : seen;
	};

	const finish = (halted: boolean): RunResult => ({ halted, turns, visits, log, stages: battle.stages(), battle });

	while (turns < maxTurns) {
		const instr = carrier.body[pc];
		at = pc;
		let target: string | null = null;
		switch (instr.op) {
		case 'INC': {
			const seen = useMove(RAISE[instr.counter]);
			if (!seen) continue; // missed: try again
			if (!seen.raised.has(COUNTER_STAT[instr.counter])) throw new Error(`turn ${turns}: INC ${instr.counter} had no effect`);
			break;
		}
		case 'DEC':
			if (!useMove(LOWER[instr.counter])) continue;
			break;
		case 'DJZ': {
			const seen = useMove(LOWER[instr.counter]);
			if (!seen) continue;
			if (!seen.lowered.has(COUNTER_STAT[instr.counter])) target = instr.target;
			break;
		}
		case 'GOTO':
			target = instr.target;
			break;
		case 'HALT':
			return finish(true);
		}
		pc++;
		if (target === null) continue;
		if (target === HALT_LABEL) return finish(true);
		pc = 0;
		if (target !== carrier.label) {
			const lines = battle.batonPass(target);
			observe(lines, carrier.label, BATON_PASS, turns + 1);
			if (!lines.some(line => line.startsWith(`|switch|p1a: ${target}|`))) {
				throw new Error(`turn ${turns + 1}: Baton Pass to ${target} failed`);
			}
			endTurn(BATON_PASS, []);
			carrier = carriers.get(target)!;
			visits.push({ label: target, turns: 0 });
		}
	}
	return finish(false);
}
