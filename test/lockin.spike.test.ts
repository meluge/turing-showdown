// Spike: with Infinite PP, which effects force P1's move choices?
//
// For every P1 request we record the legal choices and how many different battles they lead
// to (choiceOutcomes). A request is "forced" with one legal choice and "irrelevant" when
// several legal choices all reach the same state.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { FORMAT, playerView } from '../src/battle.ts';
import { choiceOutcomes, legalChoices, stateDiff } from '../src/forced.ts';

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

type Row = {
	turn: number, kind: string, legal: string[], moveChoices: number, outcomes: number, lines: string[], diff: string[],
};

/** One outcome: every legal choice (terastallizing included) leads to the same battle. */
const forced = (r: Row) => r.outcomes === 1 && !r.legal.some(c => c.startsWith('switch'));

function newBattle(team: object[], wallMoves = ['Rest'], seed = [1, 2, 3, 4]) {
	const battle = new Battle({ formatid: FORCED_FORMAT, seed });
	battle.setPlayer('p1', { name: 'Program', team });
	battle.setPlayer('p2', { name: 'Wall', team: [wall(wallMoves)] });
	const rows: Row[] = [];
	let pos = battle.log.length;
	/** Record P1's request, then play `choice` for P1 and the wall's only choice for P2. */
	const play = (choice: string) => {
		const legal = legalChoices(battle, 'p1');
		const classes = [...choiceOutcomes(battle, 'p1').keys()];
		const outcomes = classes.length;
		const diff = outcomes > 1 ? stateDiff(classes[0], classes[1]) : [];
		assert.ok(battle.choose('p1', choice), `${choice}: ${battle.p1.choice.error}`);
		const p2 = legalChoices(battle, 'p2');
		if (p2.length) {
			assert.equal(p2.length, 1, `wall not forced: ${p2}`);
			assert.ok(battle.choose('p2', p2[0]));
		}
		const lines = playerView(battle.log.slice(pos), 'p1');
		pos = battle.log.length;
		const row = {
			turn: battle.turn, kind: battle.p1.requestState, legal,
			moveChoices: legal.filter(c => /^move \d$/.test(c)).length, outcomes, lines, diff,
		};
		rows.push(row);
		return row;
	};
	const show = (title: string) => console.log(`\n${title}\n` + rows.map((r, i) =>
		`  ${String(i + 1).padStart(2)}  legal: ${r.legal.join(', ').padEnd(34)} outcomes: ${r.outcomes}  ` +
		`${r.lines.filter(l => /^\|(move|-start|-end|-fail|-miss|cant|-activate)\|/.test(l)).join(' ')}` +
		(r.diff.length ? `\n        first two outcomes differ at: ${r.diff.slice(0, 4).join('; ')}` : '')).join('\n'));
	return { battle, rows, play, show };
}

test('Encore from the wall: free on the first turn after a switch-in, irrelevant or forced after that', () => {
	const b = newBattle([smeargle('A', ['Harden', 'Growl']), smeargle('B', ['Harden', 'Growl'])], ['Encore']);
	b.play('move 1'); // no lastMove yet, Encore fails, Harden
	b.play('move 2'); // Growl chosen, but the wall is faster: Encore lands first and overrides to Harden
	for (let i = 0; i < 6; i++) b.play('move 1');
	b.play('switch 2');
	b.play('move 2'); // B's first move after switching in: Growl, Encore fails again
	b.play('move 1');
	b.show('Encore (wall: Encore only; A and B know Harden and Growl)');

	const [first, second, ...locked] = b.rows;
	assert.equal(first.outcomes, 3, 'turn 1: Harden, Growl and the switch all differ');
	assert.equal(second.moveChoices, 2);
	assert.ok(second.lines.some(l => l.startsWith('|-start|p1a: A|Encore')));
	assert.ok(second.lines.includes('|move|p1a: A|Harden|p1a: A'), 'Growl was overridden');
	// Harden and Growl now differ in one field only: where the *chosen* move was aimed. In singles
	// it is read only by lock-in and two-turn moves, and every move rewrites it first
	// (sim/pokemon.ts moveUsed), so the two choices are equivalent in effect though not in state
	assert.equal(second.outcomes, 3);
	assert.deepEqual(second.diff, ['.sides.0.pokemon.0.lastMoveTargetLoc: -1 vs 1']);
	// while Encore lasts only the voluntary switch is left, which trapping would remove
	for (const r of locked.slice(0, 6)) {
		assert.ok(r.moveChoices === 1 || r.diff.join() === second.diff.join(), JSON.stringify(r.legal));
	}
	const afterSwitch = b.rows[9];
	assert.equal(afterSwitch.moveChoices, 2);
	assert.ok(afterSwitch.lines.some(l => l.startsWith('|-fail|p2a: Wall')) ||
		!afterSwitch.lines.some(l => l.startsWith('|-start|p1a: B|Encore')), 'no Encore on the first turn in');
	assert.ok(afterSwitch.lines.includes('|move|p1a: B|Growl|p2a: Wall'), 'B keeps whatever it picked first');
});

// multi-turn moves that lock the user in on their own
const LOCKS: [string, string, number][] = [
	// move, what the forced follow-up turns look like, how many turns they last
	['Rollout', 'locked', 4],
	['Ice Ball', 'locked', 4],
	['Uproar', 'locked', 2],
	['Hyper Beam', 'recharge', 1],
	['Meteor Beam', 'charged', 1],
	['Skull Bash', 'charged', 1],
];

for (const [move, what, forcedTurns] of LOCKS) {
	test(`${move}: ${forcedTurns} forced turn(s) after it is picked (${what}), and no switching meanwhile`, () => {
		// Sweet Scent first: -6 evasion on the wall, so a 90%-accurate move cannot miss and break the lock
		const b = newBattle([smeargle('A', [move, 'Harden', 'Sweet Scent']), smeargle('B', ['Harden'])]);
		for (let i = 0; i < 3; i++) b.play('move 3');
		assert.equal(b.battle.p2.active[0].boosts.evasion, -6);
		b.rows.length = 0;

		b.play('move 1');
		for (let i = 0; i < forcedTurns + 1; i++) b.play('move 1');
		b.show(`${move} (after Sweet Scent x3)`);

		const [pick, ...rest] = b.rows;
		assert.equal(pick.legal.length, 4, 'picking the move is free: 3 moves + switch');
		for (const r of rest.slice(0, forcedTurns)) assert.ok(forced(r), `${move}: ${r.legal}`);
		assert.equal(rest[forcedTurns].legal.length, 4, 'free again once the lock ends');
	});
}

test('without Sweet Scent, a 90%-accurate lock sometimes misses and ends early (so it must be made to hit)', () => {
	let broken = 0;
	for (let seed = 1; seed <= 40; seed++) {
		const b = newBattle([smeargle('A', ['Rollout', 'Harden']), smeargle('B', ['Harden'])], ['Rest'], [seed, 2, 3, 4]);
		b.play('move 1');
		for (let i = 0; i < 4; i++) b.play('move 1');
		if (!b.rows.slice(1, 5).every(forced)) broken++;
	}
	console.log(`\nRollout without Sweet Scent: lock broken early in ${broken}/40 seeds`);
	assert.ok(broken > 0);
});
