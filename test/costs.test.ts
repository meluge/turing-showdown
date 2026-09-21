// Per-block turn costs, measured on the battle:
//   MOVE_k on R = n:  2n + 2
//   MUL_k  on T = n:  n(k+1) + 2   (one less for the last, which halts instead of passing)

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { factorial } from '../src/programs.ts';
import { run } from '../src/runner.ts';

test('factorial(5): per-block turn costs match the formulas', () => {
	const { visits } = run(factorial(5));
	const expected = [{ label: 'SETUP', turns: 13 + 1 }];
	for (let k = 2, n = 1; k <= 5; n *= k, k++) {
		expected.push({ label: `MOVE_${k}`, turns: 2 * n + 2 });
		expected.push({ label: `MUL_${k}`, turns: n * (k + 1) + (k < 5 ? 2 : 1) });
	}
	assert.deepEqual(visits, expected);
	assert.deepEqual(visits.map(v => v.turns), [14, 4, 5, 6, 10, 14, 32, 50, 145]);
});

test('every turn is accounted to exactly one block', () => {
	for (let n = 0; n <= 5; n++) {
		const { visits, turns, log } = run(factorial(n));
		assert.equal(visits.reduce((sum, v) => sum + v.turns, 0), turns);
		assert.equal(log.length, turns);
	}
});
