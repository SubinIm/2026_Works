import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { commitArtifacts, readRollback, recoverInterruptedBuild, withBuildLock } from '../transaction.mjs';

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'banner-filter-transaction-'));
  t.after(async () => {
    if (path.resolve(path.dirname(root)) !== path.resolve(os.tmpdir()) || !path.basename(root).startsWith('banner-filter-transaction-')) throw new Error('Unexpected test directory');
    await rm(root, { recursive: true, force: true });
  });
  return root;
}
const generation = number => ({ 'rules/public-ads.json': `[${number}]`, 'filters/cosmetic.json': `{"version":${number}}`, 'filters/manifest.json': `{"generation":${number}}` });

test('failure during publication restores every prior artifact', async t => {
  const root = await fixture(t);
  await commitArtifacts(root, generation(1));
  let writes = 0;
  await assert.rejects(commitArtifacts(root, generation(2), { beforeReplace() { if (++writes === 3) throw new Error('injected disk failure'); } }), /injected/);
  for (const [file, content] of Object.entries(generation(1))) assert.equal(await readFile(path.join(root, file), 'utf8'), content);
  assert.equal(await recoverInterruptedBuild(root), false);
});

test('manifest commits last and successful publication keeps a complete rollback generation', async t => {
  const root = await fixture(t);
  await commitArtifacts(root, generation(1));
  const order = [];
  await commitArtifacts(root, generation(2), { beforeReplace(file) { order.push(file); } });
  assert.equal(order.at(-1), 'filters/manifest.json');
  const rollback = await readRollback(root);
  assert.equal(String(rollback['rules/public-ads.json']), '[1]');
  await commitArtifacts(root, rollback);
  assert.equal(await readFile(path.join(root, 'rules/public-ads.json'), 'utf8'), '[1]');
});

test('the next invocation recovers a persisted interrupted-build journal', async t => {
  const root = await fixture(t);
  const directory = path.resolve(root, 'filters/.pending-backup');
  await mkdir(path.join(directory, 'rules'), { recursive: true });
  await mkdir(path.join(root, 'rules'), { recursive: true });
  await writeFile(path.join(directory, 'rules/public-ads.json'), '[1]');
  await writeFile(path.join(root, 'rules/public-ads.json'), '[2]');
  await writeFile(path.join(root, 'filters/.pending-build.json'), JSON.stringify({ directory, files: [{ path: 'rules/public-ads.json', existed: true }] }));
  assert.equal(await recoverInterruptedBuild(root), true);
  assert.equal(await readFile(path.join(root, 'rules/public-ads.json'), 'utf8'), '[1]');
});

test('refuses output outside the explicit managed artifact set', async t => {
  const root = await fixture(t);
  await assert.rejects(commitArtifacts(root, { '../outside.json': 'bad' }), /Refusing/);
});

test('a second builder cannot recover or mutate a live build journal', async t => {
  const root = await fixture(t);
  await withBuildLock(root, async () => {
    await assert.rejects(commitArtifacts(root, generation(2)), /Another build owns/);
    await assert.rejects(recoverInterruptedBuild(root), /Another build owns/);
  });
  await commitArtifacts(root, generation(1));
  assert.equal(await readFile(path.join(root, 'rules/public-ads.json'), 'utf8'), '[1]');
});
