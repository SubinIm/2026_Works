import { mkdir, readFile, writeFile, rename, rm, open } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const ALLOWED = /^(?:rules\/public-ads\.json|filters\/(?:manifest\.json|cosmetic\.json|network-source-map\.json|build-report\.json|sources\/(?:provenance\.json|easylist\.txt|korean-classic\.txt)))$/;
function target(root, relative) {
  if (!ALLOWED.test(relative)) throw new Error(`Refusing unmanaged filter output: ${relative}`);
  const absolute = path.resolve(root, relative);
  if (!absolute.startsWith(`${path.resolve(root)}${path.sep}`)) throw new Error('Filter output escaped workspace.');
  return absolute;
}
async function maybeRead(file) {
  try { return await readFile(file); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
async function replace(file, data) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.filter-build-${randomUUID()}.tmp`;
  try { await writeFile(temporary, data); await rename(temporary, file); }
  finally { await rm(temporary, { force: true }); }
}
async function removeOwnedDirectory(root, directory) {
  const absolute = path.resolve(directory);
  const boundary = path.resolve(root, 'filters');
  if (!absolute.startsWith(`${boundary}${path.sep}.`) || absolute === boundary) throw new Error('Refusing unsafe staging removal.');
  await rm(absolute, { recursive: true, force: true });
}

export async function withBuildLock(root, operation) {
  const lockFile = path.resolve(root, 'filters/.build.lock');
  await mkdir(path.dirname(lockFile), { recursive: true });
  let handle;
  try { handle = await open(lockFile, 'wx'); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    // Never recover another builder's live journal. A crashed owner's lock is
    // deliberately left visible rather than guessing that it is safe to remove.
    const owner = await maybeRead(lockFile);
    throw new Error(`Another build owns filters/.build.lock (${owner?.toString() ?? 'owner unavailable'}). If that process ended, remove only this lock file and rerun to recover.`);
  }
  try {
    await handle.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
    return await operation();
  } finally { await handle.close(); await rm(lockFile, { force: true }); }
}

export async function recoverInterruptedBuild(root, { lockHeld = false } = {}) {
  if (!lockHeld) return withBuildLock(root, () => recoverInterruptedBuild(root, { lockHeld: true }));
  const journalFile = path.resolve(root, 'filters/.pending-build.json');
  const journal = await maybeRead(journalFile);
  if (!journal) return false;
  const { directory, files } = JSON.parse(journal);
  const expected = path.resolve(root, 'filters/.pending-backup');
  if (directory !== expected || !Array.isArray(files)) throw new Error('Invalid interrupted-build journal.');
  for (const item of files) {
    const file = target(root, item.path);
    if (item.existed) await replace(file, await readFile(path.join(directory, item.path)));
    else await rm(file, { force: true });
  }
  await rm(journalFile, { force: true });
  await removeOwnedDirectory(root, directory);
  return true;
}

// Validate every artifact before this function. Each replacement is atomic;
// a persistent preimage journal restores the complete prior set on failure or
// on the next invocation after interruption. Manifest is the final commit file.
export async function commitArtifacts(root, artifacts, { beforeReplace, lockHeld = false } = {}) {
  if (!lockHeld) return withBuildLock(root, () => commitArtifacts(root, artifacts, { beforeReplace, lockHeld: true }));
  await recoverInterruptedBuild(root, { lockHeld: true });
  const entries = Object.entries(artifacts).sort(([a], [b]) => Number(a === 'filters/manifest.json') - Number(b === 'filters/manifest.json') || a.localeCompare(b));
  for (const [relative] of entries) target(root, relative);
  const backup = path.resolve(root, 'filters/.pending-backup');
  await removeOwnedDirectory(root, backup);
  await mkdir(backup, { recursive: true });
  const files = [];
  for (const [relative] of entries) {
    const prior = await maybeRead(target(root, relative));
    files.push({ path: relative, existed: prior !== null });
    if (prior !== null) {
      const copy = path.join(backup, relative);
      await mkdir(path.dirname(copy), { recursive: true });
      await writeFile(copy, prior);
    }
  }
  await writeFile(path.join(backup, 'index.json'), JSON.stringify(files));
  const journalFile = path.resolve(root, 'filters/.pending-build.json');
  await replace(journalFile, JSON.stringify({ directory: backup, files }));
  try {
    for (const [relative, contents] of entries) {
      await beforeReplace?.(relative);
      await replace(target(root, relative), contents);
    }
  } catch (error) {
    await recoverInterruptedBuild(root, { lockHeld: true });
    throw error;
  }
  await rm(journalFile, { force: true });
  // Keep the previous complete generation for an explicit --rollback.
  try {
    if (files.some(item => item.path === 'filters/manifest.json' && item.existed)) {
      const rollback = path.resolve(root, 'filters/.rollback');
      await removeOwnedDirectory(root, rollback);
      await rename(backup, rollback);
    } else await removeOwnedDirectory(root, backup);
  } catch (error) {
    console.warn(`New filter generation is committed; retaining its previous rollback snapshot failed: ${error.message}`);
  }
}

export async function readRollback(root) {
  const directory = path.resolve(root, 'filters/.rollback');
  const files = JSON.parse(await readFile(path.join(directory, 'index.json'), 'utf8'));
  if (!files.every(item => item.existed)) throw new Error('Previous generation is incomplete; cannot roll back.');
  const artifacts = {};
  for (const item of files) artifacts[item.path] = await readFile(target(directory, item.path));
  return artifacts;
}
