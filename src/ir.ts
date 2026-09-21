// Counter-machine IR.
//
//   INC  <counter>            counter ∈ {R, T}
//   DEC  <counter>            saturating decrement (stays at 0)
//   DJZ  <counter> <label>    if counter > 0: decrement, fall through; else: goto label
//   GOTO <label>
//   HALT
//
// A program is a list of labelled basic blocks; execution starts at the first.
// Every block ends in GOTO or HALT. The reserved label HALT stops the machine.

export type Counter = 'R' | 'T';
export const COUNTERS: readonly Counter[] = ['R', 'T'];

export type Instr =
	| { op: 'INC', counter: Counter }
	| { op: 'DEC', counter: Counter }
	| { op: 'DJZ', counter: Counter, target: string }
	| { op: 'GOTO', target: string }
	| { op: 'HALT' };

export interface Block {
	label: string;
	body: Instr[];
}

export interface Program {
	blocks: Block[];
}

export const HALT_LABEL = 'HALT';

// A battle starts with every stat stage at 0, and counters are stage + 6.
export const INITIAL_COUNTER = 6;

export const inc = (counter: Counter): Instr => ({ op: 'INC', counter });
export const dec = (counter: Counter): Instr => ({ op: 'DEC', counter });
export const djz = (counter: Counter, target: string): Instr => ({ op: 'DJZ', counter, target });
export const goto = (target: string): Instr => ({ op: 'GOTO', target });
export const halt = (): Instr => ({ op: 'HALT' });
export const repeat = (n: number, instr: Instr): Instr[] => Array.from({ length: n }, () => instr);

export function validate(program: Program): void {
	if (!program.blocks.length) throw new Error(`program has no blocks`);
	const labels = new Set<string>();
	for (const { label } of program.blocks) {
		if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(label)) throw new Error(`bad label "${label}"`);
		if (label === HALT_LABEL) throw new Error(`label ${HALT_LABEL} is reserved`);
		if (labels.has(label)) throw new Error(`duplicate label ${label}`);
		labels.add(label);
	}
	for (const { label, body } of program.blocks) {
		const last = body.at(-1);
		if (last?.op !== 'GOTO' && last?.op !== 'HALT') throw new Error(`block ${label} must end in GOTO or HALT`);
		// looping within a block is free, so this would spin without a turn ever passing
		if (body.length === 1 && last.op === 'GOTO' && last.target === label) throw new Error(`block ${label} only jumps to itself`);
		body.forEach((instr, i) => {
			if ((instr.op === 'GOTO' || instr.op === 'HALT') && i !== body.length - 1) {
				throw new Error(`block ${label}: ${instr.op} must be the last instruction`);
			}
			if ('target' in instr && instr.target !== HALT_LABEL && !labels.has(instr.target)) {
				throw new Error(`block ${label}: unknown label ${instr.target}`);
			}
		});
	}
}

/**
 * Text form: `LABEL:` lines open a block, `;` starts a comment, and
 * `INC R x3` repeats an instruction.
 */
export function parse(source: string): Program {
	const blocks: Block[] = [];
	source.split('\n').forEach((raw, i) => {
		const line = raw.replace(/;.*/, '').trim();
		if (!line) return;
		const fail = (msg: string): never => {
			throw new Error(`line ${i + 1}: ${msg}`);
		};
		if (line.endsWith(':')) {
			blocks.push({ label: line.slice(0, -1).trim(), body: [] });
			return;
		}
		const block = blocks.at(-1) ?? fail(`instruction before any label`);
		const words = line.split(/\s+/);
		let count = 1;
		if (/^x\d+$/.test(words.at(-1)!)) count = Number(words.pop()!.slice(1));
		const [op, ...args] = words;
		const counter = (): Counter => {
			const c = args.shift();
			return c === 'R' || c === 'T' ? c : fail(`expected counter R or T, got "${c}"`);
		};
		const label = (): string => args.shift() ?? fail(`${op} needs a label`);
		let instr: Instr;
		switch (op.toUpperCase()) {
		case 'INC': instr = inc(counter()); break;
		case 'DEC': instr = dec(counter()); break;
		case 'DJZ': instr = djz(counter(), label()); break;
		case 'GOTO': instr = goto(label()); break;
		case 'HALT': instr = halt(); break;
		default: return fail(`unknown instruction "${op}"`);
		}
		if (args.length) fail(`unexpected "${args.join(' ')}"`);
		block.body.push(...repeat(count, instr));
	});
	const program = { blocks };
	validate(program);
	return program;
}

export function show(program: Program): string {
	const lines: string[] = [];
	for (const { label, body } of program.blocks) {
		lines.push(`${label}:`);
		for (let i = 0; i < body.length;) {
			const instr = body[i];
			let n = 1;
			while (JSON.stringify(body[i + n]) === JSON.stringify(instr)) n++;
			const text = [instr.op, 'counter' in instr && instr.counter, 'target' in instr && instr.target]
				.filter(Boolean).join(' ');
			lines.push(`    ${text}${n > 1 ? ` x${n}` : ''}`);
			i += n;
		}
	}
	return lines.join('\n');
}
