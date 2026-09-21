import assert from 'node:assert/strict';
import { test } from 'node:test';
import { type Block, type Instr, type Program, HALT_LABEL, dec, djz, goto, halt, inc, parse, show, validate } from '../src/ir.ts';
import { COUNTER_STAT, MAX_MOVES, compile, movesFor } from '../src/compile.ts';
import { interpret } from '../src/interp.ts';
import { collatz, factorial } from '../src/programs.ts';
import { run } from '../src/runner.ts';

function assertAgrees(program: Program, maxTurns = Infinity) {
	const expected = interpret(program, maxTurns);
	const actual = run(program, { maxTurns });
	assert.equal(actual.halted, expected.halted);
	assert.equal(actual.turns, expected.turns);
	assert.deepEqual(actual.visits, expected.visits);
	for (const counter of ['R', 'T'] as const) {
		assert.equal(actual.stages[COUNTER_STAT[counter]] + 6, expected.counters[counter]);
	}
	return actual;
}

test('a blind run, which never reads a stage while running, computes the same thing', () => {
	const result = run(factorial(4), { blind: true });
	assert.ok(result.log.every(record => record.stages === null));
	assert.equal(result.stages.def + 6, 24);
	assert.equal(result.turns, interpret(factorial(4)).turns);
});

test('collatz: branches depend on the data', () => {
	const orbit = (n: number) => {
		const values = [n];
		while (n !== 1) values.push(n = n % 2 ? 3 * n + 1 : n / 2);
		return values;
	};
	for (const n of [1, 2, 3, 6, 7]) {
		const result = assertAgrees(collatz(n));
		assert.equal(result.stages.def + 6, 1);
		// R on each entry to HALVE is the orbit of n
		const seen = result.log
			.filter((record, i) => record.carrier !== 'HALVE' && result.log[i + 1]?.carrier === 'HALVE')
			.map(record => record.stages!.def + 6);
		assert.deepEqual(seen, orbit(n));
	}
});

test('compiling rejects a block that needs more than four moves', () => {
	const body = [inc('R'), inc('T'), dec('R'), dec('T'), goto('B')];
	const program = { blocks: [{ label: 'A', body }, { label: 'B', body: [halt()] }] };
	assert.throws(() => compile(program), /needs 5 moves/);
	// the same block without the jump fits
	assert.equal(compile({ blocks: [{ label: 'A', body: [...body.slice(0, 4), halt()] }] })[0].moves.length, 4);
});

test('validation', () => {
	assert.throws(() => validate({ blocks: [{ label: 'A', body: [inc('R')] }] }), /must end in/);
	assert.throws(() => validate({ blocks: [{ label: 'A', body: [goto('B')] }] }), /unknown label/);
	assert.throws(() => validate({ blocks: [{ label: 'A', body: [goto('A')] }] }), /only jumps to itself/);
	assert.throws(() => validate({ blocks: [{ label: 'HALT', body: [halt()] }] }), /reserved/);
});

test('the text form round-trips', () => {
	for (const program of [factorial(5), collatz(7)]) {
		assert.deepEqual(parse(show(program)), program);
	}
	const source = `
		START:            ; R := 6 + 3
		    INC R x3
		    DJZ T HALT    ; T starts at 6, so this falls through
		    GOTO DONE
		DONE:
		    HALT
	`;
	const result = assertAgrees(parse(source));
	assert.equal(result.stages.def + 6, 9);
	assert.equal(result.stages.spe + 6, 5);
});

test('random programs agree with the reference interpreter', () => {
	let state = 12345;
	const random = (n: number) => {
		state = (Math.imul(state, 1103515245) + 12345) & 0x7fffffff;
		return state % n;
	};
	const randomProgram = (): Program => {
		const labels = Array.from({ length: 2 + random(4) }, (_, i) => `B${i}`);
		const target = () => (random(6) ? labels[random(labels.length)] : HALT_LABEL);
		const counter = () => (random(2) ? 'R' : 'T') as 'R' | 'T';
		const blocks: Block[] = labels.map(label => {
			for (;;) {
				const body: Instr[] = Array.from({ length: 1 + random(5) }, () =>
					[() => inc(counter()), () => dec(counter()), () => djz(counter(), target())][random(3)]());
				body.push(random(8) ? goto(target()) : halt());
				if (movesFor(label, body).length <= MAX_MOVES) return { label, body };
			}
		});
		return { blocks };
	};
	let halted = 0;
	for (let i = 0; i < 150; i++) {
		if (assertAgrees(randomProgram(), 400).halted) halted++;
	}
	// the sample should exercise both halting and cut-off runs
	assert.ok(halted > 20 && halted < 130, `${halted} of 150 halted`);
});
