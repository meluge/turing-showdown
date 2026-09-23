// Spike: which move restrictions survive P1 switching, and can the program change them?
//
// Every source of disabled moves in the engine (grep DisableMove in data/, sim/):
//   carrier volatiles, cleared on switch:  Encore, Disable, Taunt, Torment, Heal Block,
//                                          Throat Chop, choice lock, Gorilla Tactics, cantusetwice
//   survive P1 switching:                  Gravity (field, 5 turns), Imprison (on the wall),
//                                          Assault Vest (item), Stuff Cheeks (needs a held berry),
//                                          Belch (needs ateBerry, which is never reset)
// This file checks the second group on the real engine.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { FORMAT } from '../src/battle.ts';
import { choiceOutcomes, legalChoices } from '../src/forced.ts';

const { Battle } = createRequire(import.meta.url)('../pokemon-showdown/dist/sim');
const FORCED_FORMAT = `${FORMAT},Terastal Clause`;

const NO_EVS = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
const IVS = { hp: 31, atk: 0, def: 31, spa: 31, spd: 31, spe: 31 };
const smeargle = (name: string, moves: string[], item = '') => ({
	name, species: 'Smeargle', ability: 'Own Tempo', item, gender: 'M',
	moves, level: 1, nature: 'Bold', evs: NO_EVS, ivs: IVS,
});
const wall = (moves: string[]) => ({
	name: 'Wall', species: 'Dondozo', ability: 'Unaware', item: 'Leftovers', gender: 'M',
	moves, level: 100, nature: 'Bold', evs: { ...NO_EVS, hp: 252, def: 252 }, ivs: { ...IVS, atk: 31 },
});

function newBattle(team: object[], wallMoves = ['Rest']) {
	const battle = new Battle({ formatid: FORCED_FORMAT, seed: [1, 2, 3, 4] });
	battle.setPlayer('p1', { name: 'Program', team });
	battle.setPlayer('p2', { name: 'Wall', team: [wall(wallMoves)] });
	/** P1 plays `choice`, the wall plays `wallChoice` (its only move unless told otherwise). */
	const play = (choice: string, wallChoice = 'move 1') => {
		assert.ok(battle.choose('p1', choice), `${choice}: ${battle.p1.choice.error}`);
		if (battle.p2.requestState && !battle.p2.activeRequest?.wait) assert.ok(battle.choose('p2', wallChoice));
	};
	/** P1's legal move choices by move name, without switches or terastallizing. */
	const moves = () => legalChoices(battle, 'p1')
		.filter(c => /^move \d$/.test(c))
		.map(c => battle.p1.active[0].moveSlots[Number(c.slice(5)) - 1].move);
	return { battle, play, moves };
}

test('Gravity survives switching, bans the same moves for every carrier, and covers the next 4 requests', () => {
	const b = newBattle([smeargle('A', ['Gravity', 'Splash', 'Harden']), smeargle('B', ['Splash', 'Harden'])]);
	assert.deepEqual(b.moves(), ['Gravity', 'Splash', 'Harden']);
	b.play('move 1'); // Gravity
	assert.deepEqual(b.moves(), ['Gravity', 'Harden'], 'Splash is disabled in the request');
	b.play('switch 2');
	assert.deepEqual(b.moves(), ['Harden'], 'still disabled for the carrier that switched in');
	const banned: boolean[] = [];
	for (let i = 0; i < 5; i++) {
		b.play('move 2');
		banned.push(!b.moves().includes('Splash'));
	}
	// requests after turns 1 (Gravity), 2 (the switch), 3 and 4 are covered; after turn 5 it has ended
	assert.deepEqual(banned, [true, true, false, false, false]);
});

test('Gravity from a wall that only knows Gravity: re-cast every time it ends, but one request in five is not covered', () => {
	const b = newBattle([smeargle('A', ['Splash', 'Harden'])], ['Gravity']);
	const free: number[] = [];
	for (let turn = 1; turn <= 16; turn++) {
		const legal = b.moves();
		if (legal.includes('Splash')) free.push(turn);
		// on the uncovered turns the choice still matters: Gravity lands first, so Splash
		// fails ("cant") while Harden works
		if (legal.includes('Splash') && turn > 1) assert.equal(choiceOutcomes(b.battle, 'p1').size, 2);
		b.play('move 2');
	}
	console.log(`\nwall-cast Gravity: Splash legal on turns ${free.join(', ')}`);
	assert.deepEqual(free, [1, 6, 11, 16]);
});

test('Imprison from the wall bans P1 the wall\'s moves, hidden but enforced, and survives P1 switching', () => {
	// the wall needs two moves here (Imprison, Harden), so it is not forced: this checks the effect only
	const b = newBattle([smeargle('A', ['Harden', 'Growl']), smeargle('B', ['Harden', 'Growl'])], ['Imprison', 'Harden']);
	b.play('move 2', 'move 1'); // P1 Growl, wall Imprison
	const request = b.battle.p1.activeRequest.active[0];
	console.log(`\nImprison: request shows ${JSON.stringify(request.moves.map((m: any) => [m.move, m.disabled]))}` +
		` maybeDisabled=${request.maybeDisabled}`);
	assert.deepEqual(b.moves(), ['Growl'], 'the validator refuses Harden even though the request may hide it');
	b.play('switch 2', 'move 1');
	assert.deepEqual(b.moves(), ['Growl']);
});

test('Assault Vest travels with its holder: status moves stay banned across switches', () => {
	const b = newBattle([smeargle('A', ['Harden', 'Tackle'], 'Assault Vest'), smeargle('B', ['Harden', 'Tackle'])]);
	assert.deepEqual(b.moves(), ['Tackle']);
	b.play('switch 2');
	assert.deepEqual(b.moves(), ['Harden', 'Tackle']);
	b.play('switch 2');
	assert.deepEqual(b.moves(), ['Tackle']);
});

test('the berry bit: Stuff Cheeks is legal exactly while a berry is held, across switches, and Recycle flips it back', () => {
	const b = newBattle([
		smeargle('A', ['Stuff Cheeks', 'Recycle', 'Belch'], 'Oran Berry'), smeargle('B', ['Harden']),
	]);
	assert.deepEqual(b.moves(), ['Stuff Cheeks', 'Recycle'], 'berry held: Stuff Cheeks on, Belch off (no berry eaten yet)');
	b.play('move 1'); // Stuff Cheeks: Def +2, eats the berry
	assert.equal(b.battle.p1.active[0].boosts.def, 2);
	assert.deepEqual(b.moves(), ['Recycle', 'Belch'], 'berry gone: Stuff Cheeks off; ateBerry: Belch on');
	b.play('switch 2');
	b.play('switch 2');
	assert.deepEqual(b.moves(), ['Recycle', 'Belch'], 'both survive a switch out and back');
	b.play('move 2'); // Recycle
	assert.deepEqual(b.moves(), ['Stuff Cheeks', 'Recycle', 'Belch'], 'berry back; Belch stays on for good');
});

test('two-move carriers on the berry bit: forced exactly when the bit decides between them', () => {
	// [Stuff Cheeks, Belch]: berry held and never eaten -> only Stuff Cheeks; eaten and gone -> only Belch
	const b = newBattle([smeargle('A', ['Stuff Cheeks', 'Belch'], 'Oran Berry'), smeargle('B', ['Harden'], 'Oran Berry')]);
	assert.deepEqual(b.moves(), ['Stuff Cheeks']);
	b.play('move 1');
	assert.deepEqual(b.moves(), ['Belch']);
	// and it stays that way: ateBerry is never reset, so once a berry comes back (Recycle, Harvest)
	// Stuff Cheeks and Belch are both legal. The bit forces this carrier once, in one direction.
	b.play('switch 2');
	b.play('switch 2');
	assert.deepEqual(b.moves(), ['Belch']);
});
