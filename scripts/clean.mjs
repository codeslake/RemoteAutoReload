// Removes out/ before a publish build.
//
// tsc leaves the output of a deleted source behind, and .vscodeignore ships
// every out/*.js that is not a test or a map — so publishing from a tree where
// a source was deleted without an intervening clean build packages a file
// nothing imports. Node rather than `rm -rf`, which Windows does not have.
import { rmSync } from 'node:fs';

rmSync('out', { recursive: true, force: true });
