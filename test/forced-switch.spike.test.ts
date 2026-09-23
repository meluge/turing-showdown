// Spike: with exactly two P1 Pokémon able to battle, is Eject Pack's switch forced?
// And how far is the rest of the zero test from being forced?

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { FORMAT, playerView } from '../src/battle.ts';
import { ForcednessCensus, legalChoices } from '../src/forced.ts';

const { Battle } = createRequire(import.meta.url)('../pokemon-showdown/dist/sim');

// Terastallizing is an extra option on every move request; forced play has to rule it out
const FORCED_FORMAT = `${FORMAT},Terastal Clause`;

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
const ARITH = smeargle('Arith', '', ['Spicy Extract', 'Growl']);
const TEST = smeargle('Test', 'Eject Pack', ['Psych Up', 'Superpower', 'Recycle']);

function newBattle(team: object[], format = FORCED_FORMAT) {
	const battle = new Battle({ formatid: format, seed: [1, 2, 3, 4] });
	battle.setPlayer('p1', { name: 'Program', team });
	battle.setPlayer('p2', { name: 'Wall', team: [WALL] });
	const census = new ForcednessCensus(battle);
	let pos = battle.log.length;
	const take = () => {
		const lines = playerView(battle.log.slice(pos), 'p1');
		pos = battle.log.length;
		return lines;
	};
	/** P1 makes `choice` (after the census looks at the request); P2 answers if it is asked too. */
	const play = (choice: string) => {
		census.observe('p1');
		const p2Asked = !!battle.p2.requestState && !battle.p2.activeRequest?.wait;
		if (p2Asked) census.observe('p2');
		assert.ok(battle.choose('p1', choice), battle.p1.choice.error);
		if (p2Asked) assert.ok(battle.choose('p2', 'default'), battle.p2.choice.error);
		return take();
	};
	const slotOf = (name: string) =>
		battle.p1.activeRequest.side.pokemon.findIndex((p: any) => p.ident === `p1: ${name}`) + 1;
	return { battle, census, play, take, slotOf, wall: () => battle.p2.active[0], active: () => battle.p1.active[0] };
}

test('the checker agrees with the engine: the wall has one choice, a 3-move carrier with a bench has 3 + 1', () => {
	const b = newBattle([TEST, ARITH]);
	assert.deepEqual(legalChoices(b.battle, 'p2'), ['move 1']);
	assert.deepEqual(legalChoices(b.battle, 'p1'), ['move 1', 'move 2', 'move 3', 'switch 2']);
});

test('control: without Terastal Clause every move comes twice, with and without terastallizing', () => {
	const b = newBattle([TEST, ARITH], FORMAT);
	assert.equal(legalChoices(b.battle, 'p1').length, 3 * 2 + 1);
});

test('two Pokémon left: the Eject Pack switch has exactly one legal choice, and "default" makes it', () => {
	const b = newBattle([TEST, ARITH]);
	b.play('move 1'); // Psych Up: the wall is at +0, so Superpower will drop Atk
	b.play('move 2');
	assert.equal(b.battle.p1.requestState, 'switch');
	assert.deepEqual(legalChoices(b.battle, 'p1'), ['switch 2']);
	assert.ok(b.battle.choose('p1', 'default'));
	assert.equal(b.active().name, 'Arith');
});

test('fainted teammates are never offered, so a bigger team works once all but two have fainted', () => {
	const doomed = smeargle('Doomed', '', ['Final Gambit']);
	const b = newBattle([doomed, TEST, ARITH]);
	b.play('move 1'); // Final Gambit: Doomed faints, the wall takes 12 and Leftovers heals it
	assert.equal(b.battle.p1.requestState, 'switch');
	assert.equal(legalChoices(b.battle, 'p1').length, 2, 'this replacement is still a choice: Test or Arith');
	b.play(`switch ${b.slotOf('Test')}`);
	b.play('move 1');
	b.play('move 2');
	assert.deepEqual(legalChoices(b.battle, 'p1'), [`switch ${b.slotOf('Arith')}`]);
});

test('census of one DJZ round trip on a two-Pokémon team: only the Eject Pack switch is forced', () => {
	const b = newBattle([ARITH, TEST]);
	// setup: park the wall's Def at -6 and Atk at -5 (R = 1)
	for (let i = 0; i < 3; i++) b.play('move 1'); // Spicy Extract: atk +6, def -6
	for (let i = 0; i < 11; i++) b.play('move 2'); // Growl: atk -5
	assert.equal(b.wall().boosts.atk, -5);
	b.census.records.length = 0;

	b.play('switch 2'); // to Test
	b.play('move 1'); // Psych Up
	b.play('move 2'); // Superpower: R = 1, Atk drops, Eject Pack fires
	b.play('switch 2'); // forced back to Arith
	b.play('move 2'); // DEC R: Growl, R = 0
	b.play('switch 2'); // to Test
	b.play('move 3'); // Recycle the Eject Pack
	b.play('move 1'); // Psych Up
	const zero = b.play('move 2'); // Superpower: R = 0, nothing happens
	assert.ok(!zero.some(l => l.startsWith('|-enditem|')));
	assert.equal(b.active().name, 'Test');

	const table = b.census.records.map(r => `turn ${r.turn} ${r.side} ${r.kind.padEnd(6)} ${r.legal.join(', ')}`);
	console.log(table.join('\n'));

	const p1 = b.census.records.filter(r => r.side === 'p1');
	const p2 = b.census.records.filter(r => r.side === 'p2');
	assert.ok(p2.every(r => r.legal.length === 1), 'the wall is always forced');
	assert.deepEqual(p1.filter(r => r.kind === 'switch').map(r => r.legal.length), [1], 'the eject switch is forced');
	// every move request still offers all the carrier's moves plus a voluntary switch
	for (const r of p1.filter(r => r.kind === 'move')) assert.ok(r.legal.length >= 3, JSON.stringify(r));
});

for (const [how, wallAbility, testMoves] of [
	['Shadow Tag on the wall', 'Shadow Tag', ['Psych Up', 'Superpower']],
	['Ingrain on the carrier', 'Unaware', ['Ingrain', 'Psych Up', 'Superpower']],
] as const) {
	test(`trapped by ${how}: no voluntary switch, but Eject Pack still gets out`, () => {
		const battle = new Battle({ formatid: FORCED_FORMAT, seed: [1, 2, 3, 4] });
		battle.setPlayer('p1', { name: 'Program', team: [smeargle('Test', 'Eject Pack', [...testMoves]), ARITH] });
		battle.setPlayer('p2', { name: 'Wall', team: [{ ...WALL, ability: wallAbility }] });
		const step = (m: string) => {
			assert.ok(battle.choose('p1', `move ${m}`), battle.p1.choice.error);
			assert.ok(battle.choose('p2', 'move 1'));
		};
		if (testMoves[0] === 'Ingrain') step('Ingrain');
		const legal = legalChoices(battle, 'p1');
		assert.ok(!legal.some(c => c.startsWith('switch')), legal.join(', '));
		assert.equal(legal.length, testMoves.length);
		step('Psych Up');
		step('Superpower');
		assert.equal(battle.p1.requestState, 'switch');
		assert.deepEqual(legalChoices(battle, 'p1'), ['switch 2']);
	});
}
