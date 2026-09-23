// Forced play: a request is forced when the engine accepts exactly one choice for it.
//
// Rather than reading legality off the request JSON (and getting some rule wrong), every
// candidate choice is offered to Showdown's own validator, Side.choose, then withdrawn.
// Side.choose only records a choice; Battle.choose is what commits the turn.

const CANDIDATES = [
	...[1, 2, 3, 4].flatMap(n => [`move ${n}`, `move ${n} terastallize`]),
	...[1, 2, 3, 4, 5, 6].map(n => `switch ${n}`),
	'shift', 'pass',
];

/** The choices P-side's current request allows, e.g. ['move 1', 'switch 3']. Empty when it has no request. */
export function legalChoices(battle: any, side: 'p1' | 'p2'): string[] {
	const s = battle[side];
	if (!s.requestState || s.activeRequest?.wait) return [];
	const legal: string[] = [];
	for (const choice of CANDIDATES) {
		if (s.choose(choice)) legal.push(choice);
		s.clearChoice();
	}
	return legal;
}

// what the battle has printed or sent, rather than what it is
const LOG_KEYS = new Set(['log', 'inputLog', 'messageLog', 'sentLogPos', 'sentRequests', 'lastMoveLine', 'hints']);

function stateOf(battle: any): string {
	return JSON.stringify(battle.toJSON(), (key, value) => LOG_KEYS.has(key) ? undefined : value);
}

/** Paths at which two serialized states differ, for explaining why two choices are not equivalent. */
export function stateDiff(a: string, b: string): string[] {
	const out: string[] = [];
	const walk = (x: any, y: any, path: string) => {
		if (JSON.stringify(x) === JSON.stringify(y)) return;
		if (x && y && typeof x === 'object' && typeof y === 'object') {
			for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) walk(x[k], y[k], `${path}.${k}`);
		} else {
			out.push(`${path}: ${JSON.stringify(x)} vs ${JSON.stringify(y)}`);
		}
	};
	walk(JSON.parse(a), JSON.parse(b), '');
	return out;
}

/**
 * A request can offer several choices that all lead to the same battle (Encore overrides the
 * chosen move, for instance). Plays each legal choice on a copy of the battle, answering for the
 * other side when it has exactly one choice, and groups the choices by the state they reach.
 */
export function choiceOutcomes(battle: any, side: 'p1' | 'p2'): Map<string, string[]> {
	const other = side === 'p1' ? 'p2' : 'p1';
	// Showdown serializes only format.id (sim/state.ts), which would drop our custom rules and
	// quietly replay every copy under stock rules; put them back into the format id
	const json = battle.toJSON();
	if (battle.format.customRules?.length) json.formatid = `${json.formatid}@@@${battle.format.customRules.join(',')}`;
	// a string, so that no copy shares arrays (the log among them) with the original
	const saved = JSON.stringify(json);
	const classes = new Map<string, string[]>();
	for (const choice of legalChoices(battle, side)) {
		const copy = battle.constructor.fromJSON(saved);
		for (const rule of battle.ruleTable.keys()) {
			if (!copy.ruleTable.has(rule)) throw new Error(`copy of the battle lost rule ${rule}`);
		}
		copy.choose(side, choice);
		const otherLegal = legalChoices(copy, other);
		if (otherLegal.length > 1) throw new Error(`${other} is not forced here: ${otherLegal.join(', ')}`);
		if (otherLegal.length) copy.choose(other, otherLegal[0]);
		const state = stateOf(copy);
		classes.set(state, [...classes.get(state) || [], choice]);
	}
	return classes;
}

export type RequestRecord = { turn: number, side: 'p1' | 'p2', kind: string, legal: string[] };

/** What kind of decision the request is: a move, a mid-turn or end-of-turn switch, team preview. */
export function requestKind(battle: any, side: 'p1' | 'p2'): string {
	const s = battle[side];
	return s.requestState || 'none';
}

/** Records every request both sides get, so a run can be checked for forcedness afterwards. */
export class ForcednessCensus {
	readonly records: RequestRecord[] = [];
	private battle: any;

	constructor(battle: any) {
		this.battle = battle;
	}

	/** Call whenever a side is about to choose. */
	observe(side: 'p1' | 'p2'): RequestRecord {
		const record = {
			turn: this.battle.turn, side, kind: requestKind(this.battle, side), legal: legalChoices(this.battle, side),
		};
		this.records.push(record);
		return record;
	}

	unforced(): RequestRecord[] {
		return this.records.filter(r => r.legal.length !== 1);
	}
}
