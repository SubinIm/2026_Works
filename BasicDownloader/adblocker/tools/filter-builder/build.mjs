import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { downloadSources, loadOfflineSources, sourceMetadata, sha256 } from './sources.mjs';
import { preprocessSource } from './preprocess.mjs';
import { compileNetwork, validateNetworkRules, POLICY_VERSION, VIDEO_DOMAINS } from './network.mjs';
import { parseCosmeticSources } from './cosmetic.mjs';
import { commitArtifacts, recoverInterruptedBuild, readRollback, withBuildLock } from './transaction.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const filtersDirectory = new URL('../../filters/', import.meta.url);
const json = value => `${JSON.stringify(value, null, 2)}\n`;

export function validateArtifacts(artifacts) {
  const manifest = JSON.parse(artifacts['filters/manifest.json']);
  if (manifest.schemaVersion !== 1) throw new Error('Unsupported filter manifest version.');
  for (const [relative, digest] of Object.entries(manifest.artifacts)) {
    if (!artifacts[relative] || sha256(artifacts[relative]) !== digest) throw new Error(`Artifact checksum mismatch: ${relative}`);
  }
  const rules = JSON.parse(artifacts['rules/public-ads.json']);
  validateNetworkRules(rules);
  if (rules.length !== manifest.network.ruleCount) throw new Error('Manifest network count mismatch.');
  const mapping = JSON.parse(artifacts['filters/network-source-map.json']);
  if (Object.keys(mapping.rules).length !== rules.length || rules.some(rule => !mapping.rules[rule.id])) throw new Error('Incomplete network source map.');
  const cosmetic = JSON.parse(artifacts['filters/cosmetic.json']);
  if (cosmetic.version !== 1 || !Array.isArray(cosmetic.generic) || !cosmetic.hosts) throw new Error('Invalid cosmetic data.');
  return manifest;
}

export async function build({ offline = false, lockHeld = false } = {}) {
  if (!lockHeld) return withBuildLock(root, () => build({ offline, lockHeld: true }));
  await recoverInterruptedBuild(root, { lockHeld: true });
  const sources = offline ? await loadOfflineSources(filtersDirectory) : await downloadSources();
  const processed = sources.map(preprocessSource);
  const network = await compileNetwork(processed);
  const cosmetic = parseCosmeticSources(processed);
  if (!network.report.blockCount || !cosmetic.report.accepted.hiding) throw new Error('Empty public filter result.');
  const generatedAt = new Date().toISOString();
  const metadata = sourceMetadata(sources);
  const sourceSignature = sources.map(source => `${source.key}:${source.sha256}`).join('\n');
  const filterVersion = `${sources[0].sourceVersion}-${sha256(`${POLICY_VERSION}\n${sourceSignature}`).slice(0, 12)}`;
  const { skipped, ...networkSummary } = network.report;
  const report = {
    schemaVersion: 1, generatedAt, filterVersion,
    network: network.report, cosmetic: cosmetic.report,
    platform: processed.map(source => ({ source: source.key, skippedCount: source.platformSkipped.length, skipped: source.platformSkipped })),
  };
  const artifacts = {
    'rules/public-ads.json': json(network.rules),
    'filters/cosmetic.json': json(cosmetic.data),
    'filters/network-source-map.json': json({ schemaVersion: 1, filterVersion, rules: network.sourceMap }),
    'filters/build-report.json': json(report),
    'filters/sources/provenance.json': json({ schemaVersion: 1, sources: metadata }),
  };
  for (const source of sources) artifacts[`filters/sources/${source.file}`] = source.text;
  const manifest = {
    schemaVersion: 1, generatedAt, filterVersion, policyVersion: POLICY_VERSION,
    sources: metadata, converter: network.report.converter,
    network: networkSummary,
    cosmetic: { selectorCount: cosmetic.report.accepted.hiding,
      exceptionCount: cosmetic.report.accepted.exceptions, exemptionCount: cosmetic.report.accepted.exemptions,
      unsupported: cosmetic.report.unsupported, conservativeExceptions: cosmetic.report.conservativeExceptions },
    support: { actions: ['block', 'allow', 'allowAllRequests'], blockExcludedResourceTypes: ['main_frame', 'media'],
      videoGuardDomains: VIDEO_DOMAINS, runtimeDownloads: false, remoteCode: false,
      sourceMaps: true, updateMode: 'manual-build-time', combinedLists: true,
      limitations: ['No scriptlets, procedural CSS, redirects, response/header rewriting, or in-video feature.',
        'DNR cannot express every upstream rule; rejected rules are recorded in build-report.json.',
        'Shared ad infrastructure prevents perfect separation of banner and in-video requests on unknown services.'] },
    artifacts: Object.fromEntries(Object.entries(artifacts).map(([relative, content]) => [relative, sha256(content)])),
  };
  artifacts['filters/manifest.json'] = json(manifest);
  validateArtifacts(artifacts);
  await commitArtifacts(root, artifacts, { lockHeld: true });
  return manifest;
}

async function main() {
  const args = new Set(process.argv.slice(2));
  if ([...args].some(arg => !['--offline', '--rollback'].includes(arg)) || args.size > 1) throw new Error('Usage: node build.mjs [--offline | --rollback]');
  if (args.has('--rollback')) {
    await withBuildLock(root, async () => {
      await recoverInterruptedBuild(root, { lockHeld: true });
      const artifacts = await readRollback(root);
      const manifest = validateArtifacts(artifacts);
      await commitArtifacts(root, artifacts, { lockHeld: true });
      console.log(`Restored ${manifest.filterVersion}. Reload the unpacked extension.`);
    });
    return;
  }
  const manifest = await build({ offline: args.has('--offline') });
  console.log(JSON.stringify({ filterVersion: manifest.filterVersion, generatedAt: manifest.generatedAt,
    networkRules: manifest.network.ruleCount, cosmeticSelectors: manifest.cosmetic.selectorCount,
    skippedNetwork: manifest.network.skippedCount, maxPriority: manifest.network.maxPriority }, null, 2));
  console.log('Validated and saved. Reload the unpacked extension after the build completes.');
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(`Filter build did not finish cleanly: ${error.message}\nDo not reload until a successful build or recovery. Conversion failures leave existing artifacts untouched; interrupted publication is restored from its journal on recovery.`); process.exitCode = 1; });
}
