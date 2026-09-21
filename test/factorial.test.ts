import assert from 'node:assert/strict';
import { test } from 'node:test';
import { interpret } from '../src/interp.ts';
import { factorial } from '../src/programs.ts';
import { run } from '../src/runner.ts';

const FACTORIALS = [1, 1, 2, 6, 24, 120, 720];

test('factorial(5): def = +114, spe = -6, atk = -6, 280 turns', () => {
	const result = run(factorial(5));
	assert.equal(result.halted, true);
	assert.equal(result.stages.def, 114);
	assert.equal(result.stages.spe, -6);
	assert.equal(result.stages.atk, -6);
	assert.equal(result.turns, 280);
	assert.equal(result.battle.engine.turn, 281); // the engine agrees: 280 turns have been played
});

test('factorial(5) plays exactly the expected move sequence', () => {
	const times = (n: number, ...moves: string[]) => Array.from({ length: n }, () => moves).flat();
	const expected = [...times(6, 'Superpower'), ...times(6, 'Hammer Arm'), 'Harden', 'Baton Pass'];
	for (let k = 2, n = 1; k <= 5; n *= k, k++) {
		// MOVE_k: T := R
		expected.push(...times(n, 'Superpower', 'Flame Charge'), 'Superpower', 'Baton Pass');
		// MUL_k: R := k * T
		expected.push(...times(n, 'Hammer Arm', ...times(k, 'Harden')), 'Hammer Arm');
		if (k < 5) expected.push('Baton Pass');
	}
	assert.equal(expected.length, 280);
	assert.deepEqual(run(factorial(5)).log.map(record => record.move), expected);
});

for (const [n, value] of FACTORIALS.entries()) {
	test(`factorial(${n}) = ${value}`, () => {
		const result = run(factorial(n));
		const expected = interpret(factorial(n));
		assert.equal(result.halted, true);
		assert.equal(result.stages.def + 6, value);
		assert.equal(result.stages.spe + 6, 0);
		assert.equal(expected.counters.R, value);
		assert.equal(result.turns, expected.turns);
	});
}
