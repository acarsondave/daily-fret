// Runs every tests/*.test.mjs in its own process and reports the tally.
//
// No test framework on purpose: these suites check pure functions and data, they
// need a resolver hook and an exit code, and a dependency that does the rest
// would be four hundred packages to avoid writing thirty lines.
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const only = process.argv[2];
const files = readdirSync(HERE)
  .filter((f) => f.endsWith('.test.mjs'))
  .filter((f) => !only || f.includes(only))
  .sort();

if (!files.length) {
  console.error(only ? `no test file matches "${only}"` : 'no tests found');
  process.exit(1);
}

const register =
  `import{register}from"node:module";register(${JSON.stringify(pathToFileURL(join(HERE, '_resolve.mjs')).href)});`;

let failed = 0;
for (const file of files) {
  const res = spawnSync(
    process.execPath,
    ['--import', `data:text/javascript,${encodeURIComponent(register)}`, join(HERE, file)],
    { stdio: 'inherit' },
  );
  if (res.status !== 0) failed += 1;
}

console.log(failed ? `\n${failed} of ${files.length} suites failed\n` : `\n${files.length} suites passed\n`);
process.exit(failed ? 1 : 0);
