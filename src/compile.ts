// IR -> battle team. Each basic block becomes one carrier Pokémon whose
// nickname is the block's label and whose moveset is exactly the moves the
// block uses. The program counter is "which carrier is active"; Baton Pass is
// the jump.

import { type Counter, type Instr, type Program, HALT_LABEL, validate } from './ir.ts';

export type Stat = 'atk' | 'def' | 'spa' | 'spd' | 'spe';

/** Counters live in the active carrier's stat stages: counter = stage + 6. */
export const COUNTER_STAT: Record<Counter, Stat> = { R: 'def', T: 'spe' };

export interface MoveSpec {
	name: string;
	/** the self stat changes this move attempts, one stage each */
	raises: Stat[];
	lowers: Stat[];
}

export const RAISE: Record<Counter, MoveSpec> = {
	R: { name: 'Harden', raises: ['def'], lowers: [] },
	T: { name: 'Flame Charge', raises: ['spe'], lowers: [] },
};
export const LOWER: Record<Counter, MoveSpec> = {
	R: { name: 'Superpower', raises: [], lowers: ['atk', 'def'] },
	T: { name: 'Hammer Arm', raises: [], lowers: ['spe'] },
};
export const BATON_PASS = 'Baton Pass';
export const MAX_MOVES = 4;

export interface Carrier {
	label: string;
	moves: string[];
	body: Instr[];
}

export function movesFor(label: string, body: Instr[]): string[] {
	const moves = new Set<string>();
	for (const instr of body) {
		if (instr.op === 'INC') moves.add(RAISE[instr.counter].name);
		if (instr.op === 'DEC' || instr.op === 'DJZ') moves.add(LOWER[instr.counter].name);
		if ('target' in instr && instr.target !== label && instr.target !== HALT_LABEL) moves.add(BATON_PASS);
	}
	return [...moves];
}

export function compile(program: Program): Carrier[] {
	validate(program);
	return program.blocks.map(({ label, body }) => {
		const moves = movesFor(label, body);
		if (moves.length > MAX_MOVES) {
			throw new Error(`block ${label} needs ${moves.length} moves (${moves.join(', ')}); a Pokémon knows at most ${MAX_MOVES}`);
		}
		// a Pokémon must know something; a bare HALT block never acts
		if (!moves.length) moves.push('Splash');
		return { label, moves, body };
	});
}
