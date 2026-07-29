import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildProbe } from '../probecommand';

const TARGET = { destination: 'box', label: 'box' };

test('the default probe runs ssh directly, with no shell in the way', () => {
	const p = buildProbe(TARGET, '', 'linux');

	assert.equal(p.file, 'ssh');
	assert.deepEqual(p.args, ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5', '--', 'box', 'true']);
});

test('a port becomes a flag, not part of the destination', () => {
	const p = buildProbe({ destination: 'jun@box', label: 'jun@box:2222', port: 2222 }, '', 'linux');

	assert.ok(p.args.includes('-p'));
	assert.equal(p.args[p.args.indexOf('-p') + 1], '2222');
	assert.ok(p.args.includes('jun@box'), 'the destination stays clean');
});

test('a destination that looks like a flag cannot become one', () => {
	const p = buildProbe({ destination: '-oProxyCommand=evil', label: 'x' }, '', 'linux');

	assert.equal(p.args[p.args.length - 3], '--', 'the -- guard sits right before it');
});

test('an override runs through the platform shell', () => {
	// A shell is the point of the escape hatch: it is what makes pipes and
	// redirection work in a user-supplied probe.
	const posix = buildProbe(TARGET, 'ping -c1 ${host}', 'darwin');
	assert.equal(posix.file, '/bin/sh');
	assert.equal(posix.args[0], '-c');

	const win = buildProbe(TARGET, 'ping ${host}', 'win32');
	assert.equal(win.file, 'cmd.exe', 'Windows has no /bin/sh');
	assert.equal(win.args[0], '/d');
});

test('${host} and ${port} are substituted, quoted for the platform', () => {
	const posix = buildProbe({ destination: 'jun@box', label: 'x', port: 2222 }, 'nc -z ${host} ${port}', 'linux');
	assert.match(posix.args[1]!, /'jun@box'/);
	assert.match(posix.args[1]!, /'2222'/);

	const win = buildProbe({ destination: 'jun@box', label: 'x', port: 2222 }, 'nc -z ${host} ${port}', 'win32');
	assert.match(win.args[win.args.length - 1]!, /"jun@box"/, 'cmd.exe quotes with double quotes');
});

test('a port-less target substitutes the ssh default', () => {
	const p = buildProbe(TARGET, 'nc -z ${host} ${port}', 'linux');
	assert.match(p.args[1]!, /'22'/);
});

test('a quote in the destination cannot end the quoting', () => {
	// The value comes from the window's own authority rather than from a
	// workspace, so this is belt-and-braces — but the belt is free.
	const p = buildProbe({ destination: "bo'x", label: 'x' }, 'echo ${host}', 'linux');

	assert.doesNotMatch(p.args[1]!.replace(/'\\''/g, ''), /'.*'.*'/, 'no stray quote survives');
});

test('a value containing ${port} is not rewritten by the next substitution', () => {
	const p = buildProbe({ destination: 'a${port}b', label: 'x' }, 'echo ${host}', 'linux');

	assert.match(p.args[1]!, /a\$\{port\}b/, 'one pass, so the literal survives');
});
