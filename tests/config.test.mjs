import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const raw = fs.readFileSync(path.join(ROOT, 'wrangler.jsonc'), 'utf8');
const config = JSON.parse(raw.replace(/^\s*\/\/.*$/gm, ''));

test('Wrangler config uses Worker static assets and D1 without paid-only services', () => {
  assert.equal(config.main, './src/index.mjs');
  assert.equal(config.assets.directory, './web');
  assert.deepEqual(config.assets.run_worker_first, ['/api/*']);
  assert.equal(config.d1_databases[0].binding, 'DB');
  assert.equal(config.d1_databases[0].migrations_dir, 'migrations');
  assert.equal(config.workers_dev, true);
  for (const forbidden of ['durable_objects', 'queues', 'r2_buckets', 'containers', 'hyperdrive']) {
    assert.equal(config[forbidden], undefined);
  }
});

test('secret values are not committed to Wrangler vars', () => {
  assert.equal(config.vars.ATTENDANCE_PASSWORD, undefined);
  assert.equal(config.vars.ATTENDANCE_SECRET, undefined);
});
