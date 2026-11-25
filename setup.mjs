import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

const project = fileURLToPath(new URL('.', import.meta.url));
const wrangler = fileURLToPath(new URL('./node_modules/wrangler/bin/wrangler.js', import.meta.url));
if (!existsSync(wrangler)) {
  console.error('Run npm ci in this folder first.');
  process.exit(1);
}

const sources = {
  aio: 'AIOSTREAMS_MANIFEST_URL',
  nuvio: 'NUVIO_MANIFEST_URL',
  highfly: 'HIGHFLY_MANIFEST_URL',
  cnc: 'CNC_MANIFEST_URL'
};
const terminal = createInterface({ input: process.stdin, output: process.stdout });
let selected;
try {
  const answer = await terminal.question('Sources to configure (aio, nuvio, highfly, cnc; comma-separated) [aio]: ');
  selected = [...new Set((answer.trim() || 'aio').toLowerCase().split(',').map(value => value.trim()))];
} finally {
  terminal.close();
}
if (selected.some(source => !Object.hasOwn(sources, source))) {
  console.error('Choose one or more of aio, nuvio, highfly, cnc.');
  process.exit(1);
}

function run(...args) {
  const result = spawnSync(process.execPath, [wrangler, ...args], { cwd: project, stdio: 'inherit' });
  if (result.error) console.error(result.error.message);
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run('login');
run('deploy');
for (const source of selected) {
  console.log(`Paste your own ${source} manifest URL into the Wrangler secret prompt.`);
  run('secret', 'put', sources[source]);
}
console.log('Setup complete. Add /manifest.json to the Worker URL printed above and install that URL in Nuvio.');
