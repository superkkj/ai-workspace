import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const filename = resolve(process.argv[2] ?? 'dist/server/wrangler.json');
const config = JSON.parse(await readFile(filename, 'utf8'));
if (Object.hasOwn(config, 'legacy_env')) {
  // New Wrangler removed this field; true is its unchanged default behavior.
  // Fail rather than silently change a different environment configuration.
  assert.equal(config.legacy_env, true, 'Only legacy_env: true can be removed without changing behavior.');
  delete config.legacy_env;
  await writeFile(filename, JSON.stringify(config) + '\n');
}
console.log('Prepared local test configuration; worker, assets, bindings and no_bundle are unchanged.');
