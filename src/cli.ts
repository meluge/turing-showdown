import { readFileSync, writeFileSync } from 'node:fs';
import { type Program, COUNTERS, parse, show } from './ir.ts';
import { COUNTER_STAT, compile } from './compile.ts';
import { exportTeam } from './battle.ts';
import { interpret } from './interp.ts';
import { collatz, factorial } from './programs.ts';
import { type TurnRecord, run } from './runner.ts';
import { vizPage } from './viz.ts';

const USAGE = `usage: node src/cli.ts <program> [options]

programs:
  factorial <n>      R := n!
  collatz <n>        iterate the Collatz map from n down to 1
  run <file>         a program in the text IR (see examples/)

options:
  --quiet            no turn-by-turn log
  --ir               print the IR and exit
  --team             print the compiled P1 team (Showdown export format) and exit
  --max-turns <n>    give up after n turns
  --protocol <file>  write the raw Showdown battle log
  --replay <file>    write an HTML replay for the Showdown replay viewer
  --viz <file>       write an HTML page that plays the run back as a counter machine
`;

function main(argv: string[]) {
	const flags = new Map<string, string | true>();
	const words: string[] = [];
	const takesValue = new Set(['--max-turns', '--protocol', '--replay', '--viz']);
	for (let i = 0; i < argv.length; i++) {
		if (!argv[i].startsWith('--')) words.push(argv[i]);
		else flags.set(argv[i], takesValue.has(argv[i]) ? argv[++i] : true);
	}

	let program: Program;
	const [name, arg] = words;
	if (name === 'factorial') program = factorial(Number(arg));
	else if (name === 'collatz') program = collatz(Number(arg));
	else if (name === 'run' && arg) program = parse(readFileSync(arg, 'utf8'));
	else return console.log(USAGE);

	if (flags.has('--ir')) return console.log(show(program));
	if (flags.has('--team')) return console.log(exportTeam(compile(program)));

	const printTurn = ({ turn, carrier, move, stages, failed }: TurnRecord) => {
		const shown = Object.entries(stages!).filter(([, stage]) => stage).map(([stat, stage]) => `${stat}=${stage}`);
		console.log([
			String(turn).padStart(6), carrier.padEnd(8), move.padEnd(13), shown.join(' ').padEnd(24),
			failed.length ? `failed: ${failed.join(',')}` : '',
		].join(' ').trimEnd());
	};
	const maxTurns = flags.has('--max-turns') ? Number(flags.get('--max-turns')) : Infinity;
	const result = run(program, { maxTurns, onTurn: flags.has('--quiet') ? undefined : printTurn });

	console.log(result.halted ? `\nhalted after ${result.turns} turns` : `\ngave up after ${result.turns} turns`);
	for (const counter of COUNTERS) {
		const stat = COUNTER_STAT[counter];
		console.log(`  ${counter} = ${result.stages[stat] + 6}   (${stat} stage ${result.stages[stat]})`);
	}
	console.log(`  atk stage ${result.stages.atk}`);

	const expected = interpret(program, maxTurns);
	const agrees = expected.turns === result.turns && COUNTERS.every(c => expected.counters[c] === result.stages[COUNTER_STAT[c]] + 6);
	console.log(agrees ? `matches the reference interpreter` : `MISMATCH with the reference interpreter: ${JSON.stringify(expected.counters)}, ${expected.turns} turns`);

	if (flags.has('--protocol')) writeFileSync(flags.get('--protocol') as string, result.battle.fullLog.join('\n') + '\n');
	if (flags.has('--replay')) writeFileSync(flags.get('--replay') as string, replayPage(`${name} ${arg}`, result.battle.fullLog));
	if (flags.has('--viz')) writeFileSync(flags.get('--viz') as string, vizPage(`${name} ${arg}`, program, result));
	if (!agrees) process.exitCode = 1;
}

/** Same shape as a replay downloaded from Showdown: the log plus the official viewer script. */
function replayPage(title: string, log: string[]): string {
	const safeLog = log.join('\n').replace(/<\//g, '<\\/');
	return `<!DOCTYPE html>
<meta charset="utf-8" />
<title>${title} - Pokémon counter machine</title>
<div class="wrapper replay-wrapper" style="max-width:1180px;margin:0 auto">
<input type="hidden" name="replayid" value="turingshowdown" />
<div class="battle"></div><div class="battle-log"></div><div class="replay-controls"></div><div class="replay-controls-2"></div>
<script type="text/plain" class="battle-log-data">${safeLog}
</script>
</div>
<script src="https://play.pokemonshowdown.com/js/replay-embed.js"></script>
`;
}

main(process.argv.slice(2));
