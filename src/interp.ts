// Reference interpreter: runs the IR on plain integers, with the same turn
// accounting as the battle. The battle runner is tested against this.
//
// Turn costs: INC / DEC / DJZ cost one turn (one move). A control transfer to a
// *different* block costs one more turn (Baton Pass). Looping back to the top
// of the current block, and halting, are free.

import { type Counter, type Program, HALT_LABEL, INITIAL_COUNTER, validate } from './ir.ts';

export interface Visit {
	label: string;
	turns: number;
}

export interface AbstractResult {
	halted: boolean;
	counters: Record<Counter, number>;
	turns: number;
	/** one entry per stay in a block, in execution order */
	visits: Visit[];
}

export function interpret(program: Program, maxTurns = Infinity): AbstractResult {
	validate(program);
	const blocks = new Map(program.blocks.map(b => [b.label, b]));
	const counters = { R: INITIAL_COUNTER, T: INITIAL_COUNTER };
	let block = program.blocks[0];
	let pc = 0;
	let turns = 0;
	const visits: Visit[] = [{ label: block.label, turns: 0 }];
	const result = (halted: boolean) => ({ halted, counters, turns, visits });
	const tick = () => {
		turns++;
		visits.at(-1)!.turns++;
	};

	while (turns < maxTurns) {
		const instr = block.body[pc++];
		let target: string | null = null;
		switch (instr.op) {
		case 'INC':
			counters[instr.counter]++;
			tick();
			break;
		case 'DEC':
			if (counters[instr.counter] > 0) counters[instr.counter]--;
			tick();
			break;
		case 'DJZ':
			if (counters[instr.counter] > 0) {
				counters[instr.counter]--;
			} else {
				target = instr.target;
			}
			tick();
			break;
		case 'GOTO':
			target = instr.target;
			break;
		case 'HALT':
			return result(true);
		}
		if (target === null) continue;
		if (target === HALT_LABEL) return result(true);
		pc = 0;
		if (target !== block.label) {
			tick();
			block = blocks.get(target)!;
			visits.push({ label: block.label, turns: 0 });
		}
	}
	return result(false);
}
