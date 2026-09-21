// The mechanics the construction leans on, checked against the real engine.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GeneralizedBattle } from '../src/battle.ts';

const STOCK_FORMAT = 'gen9customgame@@@!Team Preview';

const carrier = (label: string, moves: string[]) => ({ label, moves, body: [] });
const ALL = ['Superpower', 'Hammer Arm', 'Harden', 'Baton Pass'];
const newBattle = (format?: string) =>
	new GeneralizedBattle([carrier('A', ALL), carrier('B', ['Flame Charge', 'Baton Pass'])], [1, 2, 3, 4], format);
const times = (n: number, f: () => void) => {
	for (let i = 0; i < n; i++) f();
};

test('a stat at -6 cannot be lowered: nothing changes, no -unboost line, and the turn still passes', () => {
	const battle = newBattle();
	times(6, () => battle.useMove('Superpower'));
	assert.equal(battle.stages().def, -6);
	const before = battle.stages();
	const lines = battle.useMove('Superpower');
	assert.deepEqual(battle.stages(), before);
	assert.ok(lines.includes('|move|p1a: A|Superpower|p2a: Wall'));
	assert.ok(!lines.some(line => line.startsWith('|-unboost|')));
	assert.equal(battle.engine.turn, 8);
});

test('self-drops apply per stat: def still drops while atk is stuck at -6', () => {
	const battle = newBattle();
	times(6, () => battle.useMove('Superpower'));
	times(2, () => battle.useMove('Harden'));
	const lines = battle.useMove('Superpower');
	assert.ok(lines.includes('|-unboost|p1a: A|def|1'));
	assert.ok(!lines.includes('|-unboost|p1a: A|atk|1'));
	assert.equal(battle.stages().atk, -6);
	assert.equal(battle.stages().def, -5);
});

test('self-drops still happen when the attack does almost no damage', () => {
	const battle = newBattle();
	times(6, () => battle.useMove('Superpower')); // atk is now -6
	const lines = battle.useMove('Hammer Arm');
	assert.ok(lines.includes('|-unboost|p1a: A|spe|1'));
});

test('stages have no upper bound, and the multiplier stays (2+n)/2', () => {
	const battle = newBattle();
	times(20, () => battle.useMove('Harden'));
	assert.equal(battle.stages().def, 20);
	const pokemon = battle.engine.p1.active[0];
	assert.equal(pokemon.getStat('def'), Math.floor(pokemon.storedStats.def * 22 / 2));
});

test('control: under stock rules the same moves stop at +6', () => {
	const battle = newBattle(STOCK_FORMAT);
	times(8, () => battle.useMove('Harden'));
	assert.equal(battle.stages().def, 6);
});

test('Baton Pass carries stages, including -6 and values above +6', () => {
	const battle = newBattle();
	times(6, () => battle.useMove('Superpower'));
	times(14, () => battle.useMove('Harden'));
	const before = battle.stages();
	assert.equal(before.atk, -6);
	assert.equal(before.def, 8);
	const lines = battle.batonPass('B');
	assert.ok(lines.some(line => line.startsWith('|switch|p1a: B|')));
	assert.equal(battle.activeLabel(), 'B');
	assert.deepEqual(battle.stages(), before);
	assert.equal(battle.engine.turn, 22); // one turn, like any other move
});

const hardenPP = (battle: GeneralizedBattle) => {
	const slot = battle.engine.p1.active[0].moveSlots.find((s: { id: string }) => s.id === 'harden');
	return { pp: slot.pp, maxpp: slot.maxpp };
};

test('moves never lose PP (Harden has 48 at most)', () => {
	const battle = newBattle();
	times(60, () => battle.useMove('Harden'));
	assert.equal(battle.stages().def, 60);
	assert.equal(hardenPP(battle).pp, hardenPP(battle).maxpp);
});

test('control: under stock rules PP is spent', () => {
	// (kept short: with stock PP the wall soon runs out of Rest and Struggles the carrier down)
	const battle = newBattle(STOCK_FORMAT);
	times(3, () => battle.useMove('Harden'));
	assert.equal(hardenPP(battle).pp, hardenPP(battle).maxpp - 3);
});

test('the wall is inert: it never wears down, never hurts a carrier, and nothing misses it', () => {
	let crits = 0;
	for (let seed = 1; seed <= 5; seed++) {
		const battle = new GeneralizedBattle([carrier('A', ['Hammer Arm', 'Flame Charge', 'Superpower'])], [seed, 2, 3, 4]);
		for (let i = 0; i < 100; i++) {
			for (const move of ['Flame Charge', 'Hammer Arm', 'Superpower']) {
				const lines = battle.useMove(move);
				assert.ok(!lines.some(line => line.startsWith('|-miss|')));
				crits += lines.filter(line => line.startsWith('|-crit|')).length;
				battle.assertInvariants(); // wall within one Leftovers tick of full, carriers untouched
			}
		}
		assert.equal(battle.stages().spe, 0);
	}
	// crits do happen (No Guard is not Shell Armor); a level 1 attacker makes them harmless
	assert.ok(crits > 0);
});

test('no auto-tie at turn 1000', () => {
	const battle = newBattle();
	times(1100, () => battle.useMove('Harden'));
	assert.equal(battle.engine.ended, false);
	assert.equal(battle.stages().def, 1100);
});
