// A self-contained page that plays a run back as a counter machine: the
// program with the current instruction marked, both counters, what each turn
// meant, and the protocol lines P1 saw. Unlike --replay it needs no network.

import { readFileSync } from 'node:fs';
import { type Program, INITIAL_COUNTER } from './ir.ts';
import { type Stat, BATON_PASS, COUNTER_STAT, LOWER, RAISE, compile } from './compile.ts';
import { playerView } from './battle.ts';
import type { RunResult } from './runner.ts';

/** above this many turns the per-turn protocol lines are left out of the page */
const MAX_PROTOCOL_TURNS = 5000;

const FAILED_BIT: Partial<Record<Stat, number>> = { atk: 1, def: 2, spe: 4 };

/** P1's view of the log, one entry per turn; index 0 is everything before turn 1. */
function protocolByTurn(log: string[]): string[][] {
	const turns: string[][] = [[]];
	for (const line of playerView(log, 'p1')) {
		if (line === '|' || line === '|upkeep' || line.startsWith('|t:|')) continue;
		if (line.startsWith('|turn|')) turns.push([]);
		else turns.at(-1)!.push(line);
	}
	return turns;
}

export function vizPage(title: string, program: Program, result: RunResult): string {
	const carriers = compile(program);
	const blockIndex = new Map(carriers.map((c, i) => [c.label, i]));
	const moves = [...new Set(result.log.map(record => record.move))];
	const data = {
		title,
		halted: result.halted,
		initialCounter: INITIAL_COUNTER,
		counterStat: COUNTER_STAT,
		raise: { R: RAISE.R.name, T: RAISE.T.name },
		lower: { R: LOWER.R.name, T: LOWER.T.name },
		batonPass: BATON_PASS,
		blocks: carriers.map(({ label, moves, body }) => ({ label, moves, body })),
		moves,
		// one row per turn: block, pc, move, def, spe, atk, failed bits
		turns: result.log.map(({ carrier, pc, move, stages, failed }) => [
			blockIndex.get(carrier)!, pc, moves.indexOf(move), stages!.def, stages!.spe, stages!.atk,
			failed.reduce((bits, stat) => bits | (FAILED_BIT[stat] ?? 0), 0),
		]),
		protocol: result.turns <= MAX_PROTOCOL_TURNS ? protocolByTurn(result.battle.fullLog) : null,
	};
	const template = readFileSync(new URL('./viz.html', import.meta.url), 'utf8');
	const json = JSON.stringify(data).replace(/</g, '\\u003c');
	const safeTitle = title.replace(/&/g, '&amp;').replace(/</g, '&lt;');
	return template.replace('__TITLE__', () => safeTitle).replace('"__DATA__"', () => json);
}
