import { type Block, type Program, HALT_LABEL, dec, djz, goto, halt, inc, repeat } from './ir.ts';

/** Stages start at 0, i.e. both counters at 6. Drain them; this also pins atk at -6. */
const clearCounters = [...repeat(6, dec('R')), ...repeat(6, dec('T'))];

/**
 * R := n!
 *
 *   SETUP:   R := 1, T := 0
 *   MOVE_k:  T := R; R := 0          costs 2n+2 turns on R = n
 *   MUL_k:   R := k * T; T := 0      costs n(k+1)+2 turns on T = n
 *
 * for k = 2..n. The last MUL jumps to HALT, which needs no Baton Pass, so it
 * costs one turn less.
 */
export function factorial(n: number): Program {
	if (!Number.isInteger(n) || n < 0) throw new Error(`factorial needs a natural number`);
	const blocks: Block[] = [
		{ label: 'SETUP', body: [...clearCounters, inc('R'), n < 2 ? halt() : goto('MOVE_2')] },
	];
	for (let k = 2; k <= n; k++) {
		blocks.push({
			label: `MOVE_${k}`,
			body: [djz('R', `MUL_${k}`), inc('T'), goto(`MOVE_${k}`)],
		}, {
			label: `MUL_${k}`,
			body: [djz('T', k < n ? `MOVE_${k + 1}` : HALT_LABEL), ...repeat(k, inc('R')), goto(`MUL_${k}`)],
		});
	}
	return { blocks };
}

/**
 * Iterates the Collatz map from n until it reaches 1, then halts with R = 1.
 * Unlike factorial, which branch is taken depends on the data (parity), so the
 * carrier order is not fixed in advance.
 */
export function collatz(n: number): Program {
	if (!Number.isInteger(n) || n < 1) throw new Error(`collatz needs a positive integer`);
	return {
		blocks: [
			{ label: 'SETUP', body: [...clearCounters, ...repeat(n, inc('R')), goto('HALVE')] },
			// T := R div 2, R := 0; leaves through EVEN or ODD by the parity of R
			{ label: 'HALVE', body: [djz('R', 'EVEN'), djz('R', 'ODD'), inc('T'), goto('HALVE')] },
			// R := T
			{ label: 'EVEN', body: [djz('T', 'HALVE'), inc('R'), goto('EVEN')] },
			// R was 2T+1. If T = 0 it was 1: done. Else R := 3(2T+1)+1 = 6(T-1) + 10
			{ label: 'ODD', body: [djz('T', 'ONE'), ...repeat(10, inc('R')), goto('TRIPLE')] },
			{ label: 'TRIPLE', body: [djz('T', 'HALVE'), ...repeat(6, inc('R')), goto('TRIPLE')] },
			{ label: 'ONE', body: [inc('R'), halt()] },
		],
	};
}
