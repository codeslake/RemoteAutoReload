// Runs the compiled tests whose SOURCE still exists.
//
// tsc leaves the output of a deleted source file behind, so globbing out/ runs
// tests that no longer exist — a deleted test kept passing here once, which is
// the wrong direction for a lie to travel. Deriving the list from src/ makes an
// orphan unreachable, and needs no `rm`, which Windows does not have.
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const tests = readdirSync('src/test')
	.filter(f => f.endsWith('.test.ts'))
	.map(f => `out/test/${f.replace(/\.ts$/, '.js')}`);

// `node --test` with no paths falls back to discovering whatever is under the
// cwd, which would run exactly the orphans this exists to exclude.
if (tests.length === 0) {
	console.error('no test sources in src/test — refusing to let node --test discover on its own');
	process.exit(1);
}

const { status } = spawnSync(process.execPath, ['--test', ...tests], { stdio: 'inherit' });
process.exit(status ?? 1);
