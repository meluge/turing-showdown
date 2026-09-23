// Spike: the DJZ loop played by two AFK players. After setup, every choice on both sides is
// Showdown's "default" (first legal move; for a switch, first healthy bench slot), so the
// engine alone decides what happens.
//
//   R = the wall's Atk stage + 6.
//   Wall: Corviknight, Mirror Armor, knows only Torment. Mirror Armor bounces a foe's drop
//         back at the attacker, unless the stat is already at -6: that is the zero test.
//         Torment disables the move used last, so "first legal move" alternates moves 1 and 2.
//   T:    [Recycle, Growl] @ Eject Pack. Recycle restores the pack; Growl is the test:
//         R > 0  -> the -1 Atk bounces onto T -> Eject Pack -> default sends in D
//         R = 0  -> the drop fails on the wall; T stays and repeats Recycle, Growl for ever
//   D:    [Growl, Baton Pass, Decorate, Splash], Mold Breaker (ignores Mirror Armor).
//         Growl really lowers the wall's Atk (DEC R), then Baton Pass -> default sends in T.
//         Decorate and Splash are only ever chosen by hand, during setup.
//
// Program: loop { DJZ R, done; DEC R }  -- counts R down to 0, 4 turns per step.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { FORMAT, playerView } from '../src/battle.ts';

const { Battle } = createRequire(import.meta.url)('../pokemon-showdown/dist/sim');
const FORCED_FORMAT = `${FORMAT},Terastal Clause`;

const NO_EVS = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
const IVS = { hp: 31, atk: 0, def: 31, spa: 31, spd: 31, spe: 31 };
const smeargle = (name: string, ability: string, item: string, moves: string[]) => ({
	name, species: 'Smeargle', ability, item, gender: 'M', moves, level: 1, nature: 'Bold', evs: NO_EVS, ivs: IVS,
});
const D = smeargle('D', 'Mold Breaker', '', ['Growl', 'Baton Pass', 'Decorate', 'Splash']);
const T = smeargle('T', 'Own Tempo', 'Eject Pack', ['Recycle', 'Growl']);
const WALL = {
	name: 'Wall', species: 'Corviknight', ability: 'Mirror Armor', item: 'Leftovers', gender: 'M',
	moves: ['Torment'], level: 100, nature: 'Bold', evs: { ...NO_EVS, hp: 252, def: 252 }, ivs: { ...IVS, atk: 31 },
};

type Step = { turn: number, who: string, move: string, R: number, note: string };

/** Hand-played setup to R = r (the starting position), then `turns` turns of default play. */
function run(r: number, turns: number, opts: { seed?: number[], wallAbility?: string, dAbility?: string } = {}) {
	const battle = new Battle({ formatid: FORCED_FORMAT, seed: opts.seed || [1, 2, 3, 4] });
	battle.setPlayer('p1', { name: 'Program', team: [{ ...D, ability: opts.dAbility || D.ability }, T] });
	battle.setPlayer('p2', { name: 'Wall', team: [{ ...WALL, ability: opts.wallAbility || WALL.ability }] });
	const wall = () => battle.p2.active[0];
	const R = () => wall().boosts.atk + 6;
	const both = (p1: string) => {
		assert.ok(battle.choose('p1', p1), battle.p1.choice.error);
		if (battle.p2.requestState && !battle.p2.activeRequest?.wait) assert.ok(battle.choose('p2', 'default'));
	};

	// setup, by hand: D moves the wall's Atk to r - 6. Torment forbids a move twice in a row,
	// so raising alternates Decorate (+2) with Growl (-1), and lowering alternates Growl with Splash.
	while (R() < r) { both('move 3'); if (R() > r) both('move 1'); else if (R() < r) both('move 4'); }
	while (R() > r) { both('move 1'); if (R() > r) both('move 4'); }
	assert.equal(R(), r);
	both('move 2'); // Baton Pass
	assert.ok(battle.choose('p1', 'switch 2'));
	assert.equal(battle.p1.active[0].name, 'T');

	// from here on nobody decides anything
	const steps: Step[] = [];
	let pos = battle.log.length;
	for (let i = 0; i < turns && !battle.ended; i++) {
		const turn = battle.turn;
		for (let guard = 0; guard < 4; guard++) {
			const waiting = (['p1', 'p2'] as const).filter(s => battle[s].requestState && !battle[s].activeRequest?.wait &&
				!battle[s].isChoiceDone());
			if (!waiting.length || battle.turn !== turn) break;
			for (const s of waiting) assert.ok(battle.choose(s, 'default'), `${s}: ${battle[s].choice.error}`);
		}
		const lines = playerView(battle.log.slice(pos), 'p1');
		pos = battle.log.length;
		for (const line of lines) {
			const m = /^\|move\|p1a: (\w+)\|([^|]+)\|/.exec(line);
			if (m) {
				const note = lines.some(l => l.startsWith('|-enditem|p1a: T|Eject Pack')) ? 'eject' :
					lines.some(l => l.startsWith(`|-fail|p1a: ${m[1]}`) || l === '|-fail|p1a: T') ? 'fail' : '';
				steps.push({ turn, who: m[1], move: m[2], R: R(), note });
			}
		}
	}
	return { battle, steps, R, log: playerView(battle.log, 'p1') };
}

test('default play counts R = 3 down to 0, then T sits in the zero branch', () => {
	const { steps, R, battle } = run(3, 20);
	console.log('\n' + steps.map(s => `  turn ${String(s.turn).padStart(3)}  ${s.who}  ${s.move.padEnd(10)} R=${s.R} ${s.note}`).join('\n'));

	assert.equal(R(), 0);
	assert.ok(!battle.ended);
	const pattern = steps.map(s => `${s.who}:${s.move}`).join(' ');
	const step = 'T:Recycle T:Growl D:Growl D:Baton Pass';
	assert.ok(pattern.startsWith(`${step} ${step} ${step} T:Recycle T:Growl T:Recycle T:Growl`), pattern);
	assert.deepEqual(steps.filter(s => s.who === 'D' && s.move === 'Growl').map(s => s.R), [2, 1, 0], 'one DEC per nonzero test');
	assert.equal(battle.p1.active[0].name, 'T');
	assert.equal(battle.p1.active[0].item, 'ejectpack', 'zero branch: the pack never fired');
});

for (const r of [0, 1, 5, 12]) {
	test(`R = ${r}: exactly ${r} decrements, and the run agrees with a counter machine`, () => {
		const turns = 4 * r + 6;
		const { steps, R } = run(r, turns);
		assert.equal(R(), 0);
		assert.equal(steps.filter(s => s.who === 'D' && s.move === 'Growl').length, r);
		assert.equal(steps.filter(s => s.note === 'eject').length, r);
		// 4 turns per nonzero step, and the zero test is the Growl on turn 4r + 2
		const firstZeroTest = steps.findIndex((s, i) => s.who === 'T' && s.move === 'Growl' && i >= 4 * r);
		assert.equal(firstZeroTest, 4 * r + 1);
	});
}

test('above +6: R = 20 counts down too (the wall starts at Atk +14)', () => {
	const { steps, R } = run(20, 4 * 20 + 4);
	assert.equal(R(), 0);
	assert.equal(steps.filter(s => s.note === 'eject').length, 20);
});

test('it is Mirror Armor that tests: it announces itself on every nonzero test and never at zero', () => {
	const { log, steps } = run(2, 12);
	assert.equal(log.filter(l => l === '|-ability|p2a: Wall|Mirror Armor').length, 2);
	assert.equal(steps.filter(s => s.note === 'eject').length, 2);
});

test('control: without Mirror Armor, T\'s Growl just lowers the wall and nothing ejects', () => {
	const { steps } = run(3, 8, { wallAbility: 'Pressure' });
	assert.equal(steps.filter(s => s.note === 'eject').length, 0);
	assert.ok(steps.every(s => s.who === 'T'));
});

test('control: without Mold Breaker, D\'s Growl bounces too, so R never goes down', () => {
	// setup still needs Mold Breaker to lower the wall, so start at R = 6 (the wall at +0)
	const { steps, R } = run(6, 12, { dAbility: 'Own Tempo' });
	assert.equal(R(), 6);
	assert.ok(steps.filter(s => s.note === 'eject').length >= 2);
});

test('no randomness matters: 25 seeds give the same move sequence', () => {
	const seq = (seed: number) =>
		run(4, 24, { seed: [seed, 7, 7, 7] }).steps.map(s => `${s.who}:${s.move}:${s.R}`).join(' ');
	const first = seq(1);
	for (let seed = 2; seed <= 25; seed++) assert.equal(seq(seed), first, `seed ${seed}`);
});
