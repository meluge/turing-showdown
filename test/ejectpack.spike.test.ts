// Spike: can Eject Pack be the zero test, so the engine rather than the controller branches?
//
// Eject Pack fires only when a stat is actually lowered (battle.boost caps the drop first,
// so at -6 its onAfterBoost sees 0). But the holder is switched out without Baton Pass,
// so it cannot hold the counters. Design tried here instead:
//
//   counters live on P2's wall W (it never switches); W's Def is parked at -6 as a bystander
//   (Spicy Extract x3; Screech is 85% accurate and a miss leaves it short)
//   R = W's Atk stage + 6
//   INC R:  Spicy Extract (W atk +2, def -2) then Growl (W atk -1)
//   DEC R:  Growl
//   DJZ R:  carrier C @ Eject Pack uses Psych Up (copies W's stages), then Superpower
//           R > 0: atk drops -> Eject Pack -> forced switch      R = 0: nothing happens
//
// W has Unaware, so C's copied Atk (unbounded) never turns into unbounded damage.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { FORMAT, playerView } from '../src/battle.ts';

const { Battle } = createRequire(import.meta.url)('../pokemon-showdown/dist/sim');

const NO_EVS = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
const IVS = { hp: 31, atk: 0, def: 31, spa: 31, spd: 31, spe: 31 };
const smeargle = (name: string, item: string, moves: string[]) => ({
	name, species: 'Smeargle', ability: 'Own Tempo', item, gender: 'M',
	moves, level: 1, nature: 'Bold', evs: NO_EVS, ivs: IVS,
});
const WALL = {
	name: 'Wall', species: 'Dondozo', ability: 'Unaware', item: 'Leftovers', gender: 'M',
	moves: ['Rest'], level: 100, nature: 'Bold', evs: { ...NO_EVS, hp: 252, def: 252 }, ivs: { ...IVS, atk: 31 },
};
const C_MOVES = ['Psych Up', 'Superpower', 'Recycle', 'Growl'];
const ARITH = ['Spicy Extract', 'Growl'];

function newBattle(bench: string[] = ['Next'], format = FORMAT) {
	const battle = new Battle({ formatid: format, seed: [1, 2, 3, 4] });
	battle.setPlayer('p1', {
		name: 'Program',
		team: [smeargle('Arith', '', ARITH), smeargle('Test', 'Eject Pack', C_MOVES),
			...bench.map(name => smeargle(name, '', ['Psych Up', 'Growl']))],
	});
	battle.setPlayer('p2', { name: 'Wall', team: [WALL] });
	let pos = battle.log.length;
	const take = () => {
		const lines = playerView(battle.log.slice(pos), 'p1');
		pos = battle.log.length;
		return lines;
	};
	const move = (m: string) => {
		assert.ok(battle.choose('p1', `move ${m}`), battle.p1.choice.error);
		assert.ok(battle.choose('p2', 'move 1'), battle.p2.choice.error);
		return take();
	};
	const switchTo = (name: string) => {
		const party = battle.p1.activeRequest.side.pokemon;
		const slot = party.findIndex((p: any) => p.ident === `p1: ${name}`) + 1;
		assert.ok(slot, `${name} not in party`);
		// a mid-turn forced switch: the turn finishes on its own, P2 has nothing to choose
		assert.ok(battle.choose('p1', `switch ${slot}`), battle.p1.choice.error);
		return take();
	};
	const wall = () => battle.p2.active[0];
	const active = () => battle.p1.active[0];
	/** the switch targets P1 is offered right now */
	const switchOptions = () => battle.p1.activeRequest.side.pokemon
		.filter((p: any) => !p.active && !p.condition.endsWith(' fnt')).length;
	return { battle, move, switchTo, wall, active, switchOptions, take };
}

/** Park W's Def at -6 (Spicy Extract x3, which never misses) and set W's Atk to `atk` stages, from Arith; then switch to Test. */
function setup(atk: number, bench?: string[]) {
	const b = newBattle(bench);
	for (let i = 0; i < 3; i++) b.move('Spicy Extract');
	for (; b.wall().boosts.atk < atk;) {
		b.move('Spicy Extract');
		if (b.wall().boosts.atk > atk) b.move('Growl');
	}
	for (; b.wall().boosts.atk > atk;) b.move('Growl');
	assert.equal(b.wall().boosts.def, -6);
	assert.equal(b.wall().boosts.atk, atk);
	b.battle.choose('p1', 'switch 2');
	b.battle.choose('p2', 'move 1');
	b.take();
	assert.equal(b.active().name, 'Test');
	return b;
}

test('R > 0: Psych Up + Superpower drops Atk, Eject Pack forces a switch, and the counter on W survives', () => {
	const b = setup(-5);
	const before = { ...b.wall().boosts };
	b.move('Psych Up');
	assert.equal(b.active().boosts.atk, -5);
	const lines = b.move('Superpower');
	assert.ok(lines.includes('|-unboost|p1a: Test|atk|1'));
	assert.ok(lines.some(l => l.startsWith('|-enditem|p1a: Test|Eject Pack')), lines.join('\n'));
	assert.ok(b.battle.p1.activeRequest?.forceSwitch, 'engine asks P1 for a replacement');
	b.switchTo('Next');
	assert.equal(b.active().name, 'Next');
	assert.deepEqual({ ...b.wall().boosts }, before, 'counters on W untouched');
});

test('R = 0: the same two moves change nothing and no switch happens', () => {
	const b = setup(-6);
	b.move('Psych Up');
	assert.equal(b.active().boosts.atk, -6);
	assert.equal(b.active().boosts.def, -6);
	const lines = b.move('Superpower');
	assert.ok(lines.includes('|move|p1a: Test|Superpower|p2a: Wall'));
	assert.ok(!lines.some(l => l.startsWith('|-unboost|')));
	assert.ok(!lines.some(l => l.startsWith('|-enditem|')));
	assert.ok(!b.battle.p1.activeRequest?.forceSwitch);
	assert.equal(b.active().name, 'Test');
	assert.equal(b.active().item, 'ejectpack');
});

test('unbounded: R = 26 (W atk +20) still tests nonzero, and Unaware keeps the damage level-1 sized', () => {
	const b = setup(20);
	b.move('Psych Up');
	assert.equal(b.active().boosts.atk, 20);
	b.move('Superpower');
	assert.ok(b.battle.p1.activeRequest?.forceSwitch);
	const w = b.wall();
	assert.ok(w.hp >= w.maxhp - Math.floor(w.maxhp / 16), `wall at ${w.hp}/${w.maxhp}`);
});

test('the Eject Pack is reusable: the carrier Recycles it when it comes back', () => {
	const b = setup(-5);
	b.move('Psych Up');
	b.move('Superpower');
	b.switchTo('Next');
	assert.equal(b.battle.p1.pokemon.find((p: any) => p.name === 'Test').item, '');
	b.battle.choose('p1', `switch ${b.battle.p1.pokemon.findIndex((p: any) => p.name === 'Test') + 1}`);
	b.battle.choose('p2', 'move 1');
	b.take();
	b.move('Recycle');
	assert.equal(b.active().item, 'ejectpack');
	b.move('Psych Up');
	b.move('Superpower');
	assert.ok(b.battle.p1.activeRequest?.forceSwitch, 'fires again after Recycle');
});

test('forcedness: the replacement is a free choice unless exactly one Pokémon is left to send in', () => {
	const one = setup(-5, ['Next']);
	one.move('Psych Up');
	one.move('Superpower');
	// Arith is also on the bench, so even a one-carrier bench offers two targets
	assert.equal(one.switchOptions(), 2);

	const many = setup(-5, ['Next', 'Other', 'Third']);
	many.move('Psych Up');
	many.move('Superpower');
	assert.equal(many.switchOptions(), 4);
});
