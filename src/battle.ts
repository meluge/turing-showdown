// The generalized battle, played on the real (patched) Pokémon Showdown engine.
//
// P1 is the program: one Smeargle per basic block (Sketch makes every moveset
// legal). P2 is the wall: a Machamp that only knows Rest. No Guard makes every
// move against it hit, so Hammer Arm's 90% accuracy never skips a decrement.

import { createRequire } from 'node:module';
import { type Carrier, type Stat, BATON_PASS } from './compile.ts';

const require = createRequire(import.meta.url);

function loadSim() {
	try {
		return require('../pokemon-showdown/dist/sim');
	} catch {
		throw new Error(`patched Pokémon Showdown build not found; run scripts/setup.sh first`);
	}
}

// G1, G2 and the turn limit are the rules added by patches/generalized-rules.patch
export const FORMAT = 'gen9customgame@@@Unbounded Boosts Mod,Infinite PP Mod,No Turn Limit Mod,!Team Preview';

export type Stages = Record<Stat | 'accuracy' | 'evasion', number>;

const NO_EVS = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
const MAX_IVS = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };

export function carrierSet(carrier: Carrier) {
	return {
		name: carrier.label, species: 'Smeargle', ability: 'Own Tempo', item: '', gender: 'M',
		moves: carrier.moves, level: 1, nature: 'Bold', evs: NO_EVS, ivs: { ...MAX_IVS, atk: 0 },
	};
}

export const WALL_SET = {
	name: 'Wall', species: 'Machamp', ability: 'No Guard', item: 'Leftovers', gender: 'M',
	moves: ['Rest'], level: 100, nature: 'Bold', evs: { ...NO_EVS, hp: 252, def: 252, spd: 4 }, ivs: MAX_IVS,
};

export function exportTeam(carriers: Carrier[]): string {
	return loadSim().Teams.export(carriers.map(carrierSet));
}

export class GeneralizedBattle {
	/** the underlying Showdown Battle; for logging and assertions only */
	readonly engine: any;
	private logPos: number;

	constructor(carriers: Carrier[], seed = [1, 2, 3, 4], format = FORMAT) {
		const { Battle } = loadSim();
		this.engine = new Battle({ formatid: format, seed });
		this.engine.setPlayer('p1', { name: 'Program', team: carriers.map(carrierSet) });
		this.engine.setPlayer('p2', { name: 'Wall', team: [WALL_SET] });
		this.logPos = this.engine.log.length;
	}

	/** P1 uses a move. Returns the protocol lines P1 is shown for the turn. */
	useMove(move: string): string[] {
		this.choose('p1', `move ${move}`);
		this.choose('p2', `move 1`);
		return this.takeLines();
	}

	/** P1 uses Baton Pass into the carrier nicknamed `label`: still one turn. */
	batonPass(label: string): string[] {
		this.choose('p1', `move ${BATON_PASS}`);
		this.choose('p2', `move 1`);
		// the switch request is what a real client gets; party order changes as carriers swap
		const party: { ident: string }[] = this.engine.p1.activeRequest?.forceSwitch ?
			this.engine.p1.activeRequest.side.pokemon : [];
		const slot = party.findIndex(p => p.ident === `p1: ${label}`) + 1;
		if (!slot) throw new Error(`Baton Pass gave no chance to switch to ${label}`);
		this.choose('p1', `switch ${slot}`);
		return this.takeLines();
	}

	get fullLog(): string[] {
		return this.engine.log;
	}

	// ---- below: reads of hidden state, for logging and assertions only ----

	stages(): Stages {
		return { ...this.engine.p1.active[0].boosts };
	}

	activeLabel(): string {
		return this.engine.p1.active[0].name;
	}

	/** The construction needs a wall that never gets worn down and carriers that never get hurt. */
	assertInvariants(): void {
		const wall = this.engine.p2.active[0];
		if (this.engine.ended) throw new Error(`battle ended`);
		if (wall.hp < wall.maxhp - Math.floor(wall.maxhp / 16)) {
			throw new Error(`wall took more than Leftovers heals: ${wall.hp}/${wall.maxhp}`);
		}
		for (const pokemon of this.engine.p1.pokemon) {
			if (pokemon.hp !== pokemon.maxhp) throw new Error(`carrier ${pokemon.name} was damaged`);
		}
	}

	private choose(side: 'p1' | 'p2', choice: string): void {
		if (!this.engine.choose(side, choice)) {
			throw new Error(`${side} could not choose "${choice}": ${this.engine[side].choice.error}`);
		}
	}

	private takeLines(): string[] {
		const lines: string[] = this.engine.log.slice(this.logPos);
		this.logPos = this.engine.log.length;
		return playerView(lines, 'p1');
	}
}

/** `|split|pN` is followed by the line only pN sees, then the line everyone else sees. */
export function playerView(lines: string[], side: string): string[] {
	const view: string[] = [];
	for (let i = 0; i < lines.length; i++) {
		if (lines[i].startsWith('|split|')) {
			view.push(lines[i] === `|split|${side}` ? lines[i + 1] : lines[i + 2]);
			i += 2;
		} else {
			view.push(lines[i]);
		}
	}
	return view;
}
