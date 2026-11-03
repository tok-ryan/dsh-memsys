#!/usr/bin/env node
/**
 * Dynamic acceptance for the injection organ. Runs WITHOUT an API key:
 *   1. drop any stale junction, then recreate the isolated probe profile
 *   2. stage an ASCII copy of this package (never install the live source tree:
 *      a profile reset deletes node_modules links and can follow the junction)
 *   3. install the staged copy, prove the composed entry (--dump-config)
 *   4. boot with a diagnostic patch and capture the section-registration marker
 *
 * The real model round (system/message contains the section) is the lead's job.
 * Anything unproven stays unknown and this script exits non-zero.
 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const load = (relative) => import(pathToFileURL(path.join(ROOT, relative)).href);
const PROJECT = path.resolve(ROOT, '..');
const ARTIFACTS = path.join(PROJECT, '_build', 'artifacts');
const STAGE = path.join(os.tmpdir(), 'dsh-memsys-probe-pkg');
const DSH_HOME = process.env.DSH_HOME ?? path.join(os.homedir(), '.dsh');

function arg(name, fallback = null) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const PROFILE = arg('profile', 'memsys-plan1-probe');
const CASE = arg('case', 'inject');

const CLI_CMD =
  process.env.DSH_CLI ??
  'C:\\Users\\15728\\AppData\\Local\\Programs\\DeepSeek Harness\\resources\\runtime\\cli\\bin\\dsh.cmd';
const CLI_DIR = path.dirname(CLI_CMD);
const HOST_EXE =
  process.env.DSH_HOST_EXE ?? path.resolve(CLI_DIR, '..', '..', '..', '..', 'DeepSeek Harness.exe');
const CLI_JS =
  process.env.DSH_CLI_JS ??
  path.resolve(
    CLI_DIR,
    '..',
    '..',
    '..',
    'app.asar',
    'dsh',
    'node_modules',
    '@deepseek-ai',
    'dsh-desktop-host',
    'lib',
    'cli.js',
  );

if (!['inject', 'tools', 'dispatch', 'record'].includes(CASE)) {
  console.error(`LIVE_CHECK_FAIL case=${CASE} reason=unsupported_case`);
  process.exit(2);
}
if (PROFILE === 'desktop') {
  console.error('LIVE_CHECK_FAIL reason=refuse_desktop_profile');
  process.exit(2);
}

const evidence = {
  case: CASE,
  profile: PROFILE,
  node: process.version,
  host_exe: HOST_EXE,
  stage: STAGE,
  started_at: new Date().toISOString(),
  steps: [],
};

function record(step, ok, detail) {
  evidence.steps.push({ step, ok, detail });
  return ok;
}

function run(args, options = {}) {
  const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1', ...(options.env ?? {}) };
  return spawnSync(HOST_EXE, ['--expose-internals', CLI_JS, ...args], {
    encoding: 'utf8',
    timeout: options.timeout ?? 180000,
    env,
    cwd: options.cwd ?? ROOT,
  });
}

function fail(code, extra = {}) {
  const payload = { ...evidence, ...extra, result: 'fail', code };
  fs.mkdirSync(ARTIFACTS, { recursive: true });
  fs.writeFileSync(
    path.join(ARTIFACTS, `live-check-${CASE}-failed.json`),
    `${JSON.stringify(payload, null, 2)}\n`,
    'utf8',
  );
  console.error(`LIVE_CHECK_FAIL case=${CASE} capability=inject_section reason=${code}`);
  process.exit(1);
}

if (!fs.existsSync(HOST_EXE)) fail('host_exe_missing', { host_exe: HOST_EXE });

// 0. A previous run may have linked the live source tree into the profile.
//    Remove that junction by directory entry only; its target is never touched.
const junction = path.join(DSH_HOME, 'profiles', PROFILE, 'node_modules', 'memsys');
try {
  const stat = fs.lstatSync(junction);
  if (stat.isSymbolicLink() || stat.isDirectory()) {
    fs.rmdirSync(junction);
    record('junction_removed', true, { path: junction });
  }
} catch {
  record('junction_removed', true, { path: junction, existed: false });
}

// 1. Isolated profile recreated from the shipped headless template.
const dumpBefore = run(['--profile', PROFILE, '--from-default-profile', 'headless', '--dump-config']);
record('profile_prepared', dumpBefore.status === 0, {
  exit: dumpBefore.status,
  stderr_tail: String(dumpBefore.stderr ?? '').split(/\r?\n/).slice(-3).join('\n'),
});

// 2. Stage an ASCII copy; the live source tree is never linked into a profile.
fs.rmSync(STAGE, { recursive: true, force: true });
fs.mkdirSync(STAGE, { recursive: true });
for (const name of ['package.json', 'index.mjs', 'client.js', 'cordis.patch.yml']) {
  fs.copyFileSync(path.join(ROOT, name), path.join(STAGE, name));
}
fs.cpSync(path.join(ROOT, 'src'), path.join(STAGE, 'src'), { recursive: true });
const stageToolsPath = path.join(STAGE, 'src', 'runtime', 'tools.mjs');
const stageIndexPath = path.join(STAGE, 'index.mjs');
const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const stageHash = {
  index: fs.existsSync(stageIndexPath) ? sha256(stageIndexPath) : null,
  tools: fs.existsSync(stageToolsPath) ? sha256(stageToolsPath) : null,
};
evidence.stage_hash = stageHash;
const stageToolsText = fs.existsSync(stageToolsPath) ? fs.readFileSync(stageToolsPath, 'utf8') : '';
const stageFresh =
  stageToolsText.includes('direct_hit_count') &&
  stageToolsText.includes('TOOL_OUTPUT_SCHEMAS') &&
  !stageToolsText.includes('properties: { text: { type: \'string\', required: true } }');
record('package_staged', fs.existsSync(stageIndexPath), { stage: STAGE, stage_hash: stageHash, fresh: stageFresh });
if (!stageFresh) {
  evidence.result = 'stale_stage';
  evidence.reason = 'staged_package_missing_current_output_schema';
  fs.mkdirSync(ARTIFACTS, { recursive: true });
  fs.writeFileSync(path.join(ARTIFACTS, `live-check-${CASE}-stale.json`), JSON.stringify(evidence, null, 2) + '\n', 'utf8');
  console.log('LIVE_CHECK_FAIL case=' + CASE + ' reason=stale_stage stage_hash=' + JSON.stringify(stageHash));
  process.exit(2);
}

// 3. Install the staged copy into the probe profile. Remove first, otherwise a
// previously failed run can leave the old package installed under the same id.
const staleRemove = run(['plugin', '--profile', PROFILE, 'remove', 'dsh-memsys'], { timeout: 240000 });
record('stale_plugin_removed', true, { exit: staleRemove.status });
const install = run(['plugin', '--profile', PROFILE, 'add', STAGE], { timeout: 240000 });
record('plugin_install', install.status === 0, {
  exit: install.status,
  stderr_tail: String(install.stderr ?? '').split(/\r?\n/).slice(-8).join('\n'),
});
if (install.status !== 0) fail('plugin_install_failed');

const dumpAfter = run(['--profile', PROFILE, '--dump-config']);
const composed = String(dumpAfter.stdout ?? '');
const entryPresent = /id:\s*memsys\b/.test(composed) && /dsh-memsys/.test(composed);
record('plugin_composed', entryPresent, { exit: dumpAfter.status });
if (!entryPresent) fail('plugin_entry_missing');

// Prove the profile actually holds the staged code, not an older install under
// the same plugin id.
const profileModules = path.join(DSH_HOME, 'profiles', PROFILE, 'node_modules');
const installedCandidates = [
  path.join(profileModules, 'dsh-memsys', 'src', 'runtime', 'tools.mjs'),
  path.join(profileModules, 'memsys', 'src', 'runtime', 'tools.mjs'),
];
const installedTools = installedCandidates.find((candidate) => fs.existsSync(candidate)) ?? null;
const installedToolsHash = installedTools
  ? crypto.createHash('sha256').update(fs.readFileSync(installedTools)).digest('hex')
  : null;
const installedFresh = Boolean(
  installedTools &&
  fs.readFileSync(installedTools, 'utf8').includes('TOOL_OUTPUT_SCHEMAS') &&
  installedToolsHash === evidence.stage_hash?.tools,
);
record('installed_stage_matches', installedFresh, {
  installed_tools: installedTools,
  installed_tools_hash: installedToolsHash,
  stage_tools_hash: evidence.stage_hash?.tools ?? null,
});
if (!installedFresh) {
  evidence.result = 'stale_stage';
  evidence.reason = 'installed_profile_package_differs_from_stage';
  fs.mkdirSync(ARTIFACTS, { recursive: true });
  fs.writeFileSync(path.join(ARTIFACTS, `live-check-${CASE}-stale.json`), JSON.stringify(evidence, null, 2) + '\n', 'utf8');
  console.log('LIVE_CHECK_FAIL case=' + CASE + ' reason=stale_stage installed_hash=' + installedToolsHash + ' stage_hash=' + evidence.stage_hash?.tools);
  process.exit(2);
}

// 4d. Dispatch case: prepare a real DB, boot with a direct prompt, read tool events.
if (CASE === 'dispatch') {
  const { resolveConfig } = await load('src/config.mjs');
  const { openAll, closeAll } = await load('src/storage/open.mjs');
  const { discoverMigrations, migrateAll } = await load('src/storage/migrate.mjs');
  const { seedInitialRegistry } = await load('src/storage/repositories.mjs');
  const { ingestInput } = await load('src/write/observe.mjs');
  const { systemClock } = await load('src/clock.mjs');
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'memsys-dispatch-db-'));
  const handles = openAll(resolveConfig({ dataDir }));
  try {
    migrateAll(handles, { clock: systemClock });
    handles.main.exec('BEGIN IMMEDIATE');
    seedInitialRegistry(handles.main, systemClock);
    handles.main.exec('COMMIT');
    const deps = { main: handles.main, control: handles.control, clock: systemClock };
    for (const [index, textValue] of ['记住：葱可以吃', '记住：葱是绿的'].entries()) {
      ingestInput(
        { role: 'daily', identity: 'dispatch', sessionId: 'dispatch', roundId: 'd', callId: 'd' + index, messageSeq: index + 1 },
        { text: textValue, messageSeq: index + 1 },
        deps,
      );
    }
    record('dispatch_db_prepared', true, { memories: handles.main.prepare('SELECT COUNT(*) AS n FROM memories').get().n });
  } finally {
    closeAll(handles);
  }
  const dispatchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'memsys-dispatch-'));
  const patchPath = path.join(dispatchDir, 'probe.patch.yml');
  const probePath = path.join(dispatchDir, 'dispatch.json');
  fs.writeFileSync(patchPath, '- id: memsys\n  config:\n    auto_inject: false\n    diagnostic_section: false\n', 'utf8');
  const promptText = '调用 memsys_search 工具，keywords=["葱"]，把返回的 direct_hit_count 原样写出来';
  const bootEnv = { ...process.env, MEMSYS_DATA_DIR: dataDir, MEMSYS_DISPATCH_PROBE: probePath };
  const boot = run(['--profile', PROFILE, '--patch', patchPath, 'headless', promptText], { timeout: 180000, env: bootEnv });
  const probe = fs.existsSync(probePath) ? JSON.parse(fs.readFileSync(probePath, 'utf8')) : null;
  const handlerProbe = fs.existsSync(probePath + '.handler.json')
    ? JSON.parse(fs.readFileSync(probePath + '.handler.json', 'utf8'))
    : null;
  const stderrText = String(boot.stderr ?? '');
  const credentialBlocked = /MISSING_CREDENTIAL|AUTH:\s/.test(stderrText);
  const remove = run(['plugin', '--profile', PROFILE, 'remove', 'dsh-memsys'], { timeout: 240000 });
  record('plugin_removed', remove.status === 0, { exit: remove.status });
  const artifact = {
    ...evidence,
    stage_hash: evidence.stage_hash ?? null,
    seeded_data_dir: dataDir,
    seeded_memories: 2,
    handler_data_dir: handlerProbe?.data_dir ?? null,
    handler_memories: handlerProbe?.memories ?? null,
    case: 'dispatch',
    probe,
    boot_exit: boot.status,
    stderr_tail: stderrText.split(/\r?\n/).slice(-8).join('\n'),
    model_output_tail: String(boot.stdout ?? '').split(/\r?\n/).slice(-20).join('\n'),
  };
  fs.mkdirSync(ARTIFACTS, { recursive: true });
  if (!probe) {
    artifact.result = credentialBlocked ? 'blocked' : 'unavailable';
    artifact.reason = credentialBlocked ? 'credential_unavailable' : 'no_dispatch_probe';
    fs.writeFileSync(path.join(ARTIFACTS, 'live-check-dispatch.json'), JSON.stringify(artifact, null, 2) + '\n', 'utf8');
    console.log('LIVE_CHECK_PARTIAL case=dispatch reason=' + artifact.reason + ' exit=' + boot.status);
    process.exit(credentialBlocked ? 2 : 1);
  }
  const schemas = probe.schemas ?? [];
  const calls = probe.calls ?? [];
  const events = probe.events ?? [];
  const modelText = String(boot.stdout ?? '') + '\n' + stderrText + '\n' + events.map((event) => event.data ?? event.raw ?? '').join('\n');
  const toolCalls = probe.tool_calls ?? [];
  const toolResults = probe.tool_results ?? [];
  const capture = toolCalls.length > 0 || toolResults.length > 0 ? 'ok' : 'missed';
  const countMatch = /direct_hit_count\D{0,12}(\d+)/.exec(modelText);
  const resultText = toolResults.map((entry) => entry.data ?? '').join('\n') + '\n' + calls.map((call) => call.result ?? '').join('\n');
  const resultCountMatch = /direct_hit_count\D{0,12}(\d+)/.exec(resultText);
  const observedCount = resultCountMatch ? Number(resultCountMatch[1]) : countMatch ? Number(countMatch[1]) : null;
  const invalidOutput = /returned invalid output|invalid output:/.test(modelText) ||
    calls.some((call) => /invalid output/i.test(call.error ?? call.result ?? ''));
  const callEvent = events.some((event) => /tool\/call|tool_call/.test(event.raw) && /memsys_search/.test(event.raw));
  const resultEvent = events.some((event) => /tool\/result|tool_result/.test(event.raw) && /direct_hit_count|memsys_search/.test(event.raw));
  const searchCall = calls.find((call) => call.name === 'memsys_search');
  if (
    (toolCalls.length > 0 || callEvent || searchCall) &&
    observedCount !== null &&
    observedCount >= 1
  ) {
    artifact.result = 'ok';
    artifact.dispatch = 'ok';
    artifact.evidence = { call: searchCall, schemas };
    artifact.observed_count = observedCount;
    artifact.capture = capture;
    fs.writeFileSync(path.join(ARTIFACTS, 'live-check-dispatch.json'), JSON.stringify(artifact, null, 2) + '\n', 'utf8');
    console.log('LIVE_CHECK_OK case=dispatch dispatch=ok calls=' + calls.length + ' memories=2');
    process.exit(0);
  }
  if (invalidOutput) {
    artifact.result = 'executed_but_output_invalid';
    artifact.dispatch = 'executed_but_output_invalid';
    artifact.reason = 'host_rejected_tool_output';
    const match = /Error:[^\\n]*(returned invalid output[^\\n]*)/.exec(modelText);
    artifact.host_error = match ? match[1].slice(0, 800) : null;
    fs.writeFileSync(path.join(ARTIFACTS, 'live-check-dispatch.json'), JSON.stringify(artifact, null, 2) + '\n', 'utf8');
    console.log('LIVE_CHECK_FAIL case=dispatch dispatch=executed_but_output_invalid');
    process.exit(1);
  }
  if (boot.status !== 0) {
    artifact.result = 'blocked';
    artifact.dispatch = 'blocked';
    artifact.reason = 'boot_failed_before_dispatch';
    fs.writeFileSync(path.join(ARTIFACTS, 'live-check-dispatch.json'), JSON.stringify(artifact, null, 2) + '\n', 'utf8');
    console.log('LIVE_CHECK_PARTIAL case=dispatch reason=boot_failed_before_dispatch exit=' + boot.status);
    process.exit(2);
  }
  if (!schemas.includes('memsys_search')) {
    artifact.result = 'unavailable';
    artifact.dispatch = 'unavailable';
    artifact.reason = 'tool_not_in_session_visible_list';
    fs.writeFileSync(path.join(ARTIFACTS, 'live-check-dispatch.json'), JSON.stringify(artifact, null, 2) + '\n', 'utf8');
    console.log('LIVE_CHECK_FAIL case=dispatch dispatch=unavailable schemas=' + schemas.length);
    process.exit(1);
  }
  if ((toolCalls.length > 0 || callEvent || searchCall) && observedCount === 0) {
    artifact.result = 'empty_result';
    artifact.dispatch = 'empty_result';
    artifact.reason = 'tool_called_but_zero_hits';
    artifact.observed_count = observedCount;
    artifact.capture = capture;
    fs.writeFileSync(path.join(ARTIFACTS, 'live-check-dispatch.json'), JSON.stringify(artifact, null, 2) + '\n', 'utf8');
    console.log('LIVE_CHECK_FAIL case=dispatch dispatch=empty_result count=0');
    process.exit(1);
  }
  if (capture === 'missed') {
    artifact.result = 'capture_missed';
    artifact.dispatch = 'unknown';
    artifact.reason = 'session_events_do_not_expose_tool_calls';
    artifact.observed_count = observedCount;
    artifact.capture = capture;
    fs.writeFileSync(path.join(ARTIFACTS, 'live-check-dispatch.json'), JSON.stringify(artifact, null, 2) + '\n', 'utf8');
    console.log('LIVE_CHECK_FAIL case=dispatch capture=missed count=' + observedCount);
    process.exit(1);
  }
  artifact.result = 'refused';
  artifact.dispatch = 'refused';
  artifact.reason = 'visible_but_not_called';
  artifact.capture = capture;
  fs.writeFileSync(path.join(ARTIFACTS, 'live-check-dispatch.json'), JSON.stringify(artifact, null, 2) + '\n', 'utf8');
  console.log('LIVE_CHECK_FAIL case=dispatch dispatch=refused');
  process.exit(1);
}

// 4r. Record case: boot with an explicit candidate prompt, then inspect the DB.
if (CASE === 'record') {
  const { resolveConfig } = await load('src/config.mjs');
  const { openAll, closeAll } = await load('src/storage/open.mjs');
  const { migrateAll } = await load('src/storage/migrate.mjs');
  const { seedInitialRegistry } = await load('src/storage/repositories.mjs');
  const { systemClock } = await load('src/clock.mjs');
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'memsys-record-db-'));
  let handles = openAll(resolveConfig({ dataDir }));
  try {
    migrateAll(handles, { clock: systemClock });
    handles.main.exec('BEGIN IMMEDIATE');
    seedInitialRegistry(handles.main, systemClock);
    handles.main.exec('COMMIT');
  } finally {
    closeAll(handles);
  }
  const dispatchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'memsys-record-'));
  const patchPath = path.join(dispatchDir, 'record.patch.yml');
  const probePath = path.join(dispatchDir, 'record.json');
  fs.writeFileSync(patchPath, '- id: memsys\n  config:\n    auto_inject: false\n    diagnostic_section: false\n', 'utf8');
  const promptText = '调用 memsys_record 工具，kind="candidate"，items=[{text:"鲸鱼娘会拍水"}]，把返回的 status 原样写出来';
  const boot = run(['--profile', PROFILE, '--patch', patchPath, 'headless', promptText], {
    timeout: 180000,
    env: { ...process.env, MEMSYS_DATA_DIR: dataDir, MEMSYS_DISPATCH_PROBE: probePath },
  });
  const probe = fs.existsSync(probePath) ? JSON.parse(fs.readFileSync(probePath, 'utf8')) : null;
  const handlerProbe = fs.existsSync(probePath + '.handler.json')
    ? JSON.parse(fs.readFileSync(probePath + '.handler.json', 'utf8'))
    : null;
  const remove = run(['plugin', '--profile', PROFILE, 'remove', 'dsh-memsys'], { timeout: 240000 });
  record('plugin_removed', remove.status === 0, { exit: remove.status });
  const artifact = { ...evidence, case: 'record', probe, boot_exit: boot.status, handler_data_dir: handlerProbe?.data_dir ?? null, stage_hash: evidence.stage_hash ?? null, model_output_tail: String(boot.stdout ?? '').split(/\r?\n/).slice(-15).join('\n') };
  handles = null;
  if (fs.existsSync(dataDir)) {
    handles = openAll(resolveConfig({ dataDir }));
    const counts = {};
    for (const table of ['memories', 'candidates', 'observations']) counts[table] = handles.main.prepare('SELECT COUNT(*) AS n FROM ' + table).get().n;
    const candidate = handles.main.prepare('SELECT * FROM candidates WHERE text = ? ORDER BY recorded_at DESC LIMIT 1').get('鲸鱼娘会拍水');
    const memory = handles.main.prepare('SELECT * FROM memories WHERE text = ? ORDER BY recorded_at DESC LIMIT 1').get('鲸鱼娘会拍水');
    artifact.db_counts = counts;
    artifact.new_candidate = candidate ? { id: candidate.id, text: candidate.text, origin: candidate.origin, creator_session_id: candidate.creator_session_id } : null;
    artifact.new_memory = memory ? { id: memory.id, origin: memory.origin } : null;
    closeAll(handles);
  }
  const resultText = JSON.stringify(probe?.calls ?? []) + JSON.stringify(probe?.tool_results ?? []);
  const execInfo = handlerProbe?.runtime ?? probe?.calls?.find((call) => call.name === 'memsys_record')?.exec ?? null;
  artifact.exec_capture = probe?.calls?.find((call) => call.name === 'memsys_record')?.exec ? 'ok' : 'missed';
  artifact.exec = execInfo;
  artifact.observed_count = artifact.db_counts?.candidates ?? 0;
  if (!probe || boot.status !== 0) {
    artifact.result = 'record=blocked';
    fs.writeFileSync(path.join(ARTIFACTS, 'live-check-record.json'), JSON.stringify(artifact, null, 2) + '\n', 'utf8');
    console.log('LIVE_CHECK_PARTIAL case=record record=blocked');
    process.exit(2);
  }
  if (/runtime_identity_unavailable|validation_error/.test(resultText)) {
    artifact.result = 'record=called_but_rejected';
    fs.writeFileSync(path.join(ARTIFACTS, 'live-check-record.json'), JSON.stringify(artifact, null, 2) + '\n', 'utf8');
    console.log('LIVE_CHECK_FAIL case=record record=called_but_rejected');
    process.exit(1);
  }
  if (!probe.tool_calls || probe.tool_calls.length === 0) {
    artifact.result = 'record=capture_missed';
    fs.writeFileSync(path.join(ARTIFACTS, 'live-check-record.json'), JSON.stringify(artifact, null, 2) + '\n', 'utf8');
    console.log('LIVE_CHECK_FAIL case=record record=capture_missed');
    process.exit(1);
  }
  let originTokens = [];
  try {
    const parsedOrigin = JSON.parse(String(artifact.new_candidate?.origin ?? '[]'));
    originTokens = Array.isArray(parsedOrigin) ? parsedOrigin.map(String) : [String(parsedOrigin)];
  } catch {
    originTokens = [];
  }
  const modelTokens = originTokens.filter((token) => token.startsWith('model:'));
  const originMatch = modelTokens
    .map((token) => /^model:([^:]*):([^:]+):([^:]+)$/.exec(token))
    .find((match) => match && (!execInfo || (match[2] === execInfo.sessionId && match[3] === execInfo.callId))) ?? null;
  artifact.origin = originMatch
    ? { author_kind: 'model', agent_id: originMatch[1], session_id: originMatch[2], call_id: originMatch[3] }
    : null;
  const agentMatch = originMatch && execInfo
    ? (!originMatch[1] || !execInfo.agentId || originMatch[1] === execInfo.agentId)
    : false;
  const sessionMatch = originMatch && execInfo
    ? originMatch[2] === execInfo.sessionId && originMatch[3] === execInfo.callId && agentMatch
    : false;
  artifact.observed_count = artifact.db_counts?.candidates ?? 0;
  if (artifact.new_candidate && sessionMatch) {
    artifact.result = 'record=ok';
    const artifactPath = path.join(ARTIFACTS, 'live-check-record.json');
    fs.writeFileSync(artifactPath, JSON.stringify(artifact, null, 2) + '\n', 'utf8');
    try {
      const written = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
      if (written.result !== 'record=ok' || written.new_candidate?.text !== artifact.new_candidate.text) {
        throw new Error('artifact_roundtrip_mismatch');
      }
    } catch (err) {
      console.error('artifact_write_failed', err.message);
      process.exit(3);
    }
    console.log('LIVE_CHECK_OK case=record record=ok');
    process.exit(0);
  }
  artifact.result = artifact.new_candidate ? 'record=partial' : 'record=called_but_rejected';
  fs.writeFileSync(path.join(ARTIFACTS, 'live-check-record.json'), JSON.stringify(artifact, null, 2) + '\n', 'utf8');
  console.log('LIVE_CHECK_FAIL case=record ' + artifact.result);
  process.exit(1);
}

// 4. Boot with a diagnostic patch; the plugin writes a marker at section() time.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'memsys-live-'));
const patchPath = path.join(tmpDir, 'probe.patch.yml');
const markerPath = path.join(tmpDir, 'section.json');
fs.writeFileSync(
  patchPath,
  '- id: memsys\n  config:\n    auto_inject: false\n    diagnostic_section: true\n',
  'utf8',
);

const toolMarkerPath = path.join(tmpDir, 'tools.json');
const bootEnv = { ...process.env, MEMSYS_SECTION_PROBE: markerPath, MEMSYS_TOOL_PROBE: toolMarkerPath };
delete bootEnv.DEEPSEEK_API_KEY;
delete bootEnv.OPENAI_API_KEY;
delete bootEnv.DEEPSEEK_BASE_URL;

const boot = run(['--profile', PROFILE, '--patch', patchPath, 'headless', 'noop'], {
  timeout: 120000,
  env: bootEnv,
});
const marker = fs.existsSync(markerPath)
  ? JSON.parse(fs.readFileSync(markerPath, 'utf8'))
  : null;
const toolEvidence = fs.existsSync(toolMarkerPath)
  ? JSON.parse(fs.readFileSync(toolMarkerPath, 'utf8'))
  : null;
record(CASE === 'tools' ? 'tools_registered' : 'section_registered', Boolean(CASE === 'tools' ? toolEvidence : marker), {
  exit: boot.status,
  marker: CASE === 'tools' ? null : marker,
  tools: CASE === 'tools' ? toolEvidence : null,
  stderr_tail: String(boot.stderr ?? '').split(/\r?\n/).slice(-8).join('\n'),
});

// 5. Cleanup: remove the package from the profile, drop the stage and temp files.
const remove = run(['plugin', '--profile', PROFILE, 'remove', 'dsh-memsys'], { timeout: 240000 });
record('plugin_removed', remove.status === 0, { exit: remove.status });
fs.rmSync(tmpDir, { recursive: true, force: true });
fs.rmSync(STAGE, { recursive: true, force: true });

if (CASE === 'tools') {
  const stderrText = String(boot.stderr ?? '');
  const credentialBlocked = /MISSING_CREDENTIAL|AUTH:\s/.test(stderrText);
  if (!toolEvidence && credentialBlocked) {
    const blocked = {
      ...evidence,
      result: 'blocked',
      reason: 'credential_unavailable',
      plugin_installed: true,
      registration: 'not_executed',
      note: 'tool registration needs a booted host; without a provider key the host exits before plugin apply',
    };
    fs.mkdirSync(ARTIFACTS, { recursive: true });
    fs.writeFileSync(path.join(ARTIFACTS, `live-check-${CASE}-blocked.json`), `${JSON.stringify(blocked, null, 2)}\n`, 'utf8');
    console.log('LIVE_CHECK_PARTIAL case=tools plugin=installed registration=not_executed reason=credential_unavailable');
    process.exit(2);
  }
  if (!toolEvidence) fail('tools_not_registered', { bootExit: boot.status });
  if (toolEvidence.result !== 'ok' || !toolEvidence.get_found || !toolEvidence.schemas_has_memsys) {
    fail('tools_registration_unconfirmed', { toolEvidence });
  }
  evidence.tools = toolEvidence;
  evidence.auto_inject = false;
  evidence.delivery = 'unknown';
  evidence.result = 'ok';
  evidence.status = 'passed';
  fs.mkdirSync(ARTIFACTS, { recursive: true });
  fs.writeFileSync(
    path.join(ARTIFACTS, `live-check-${CASE}.json`),
    `${JSON.stringify(evidence, null, 2)}\n`,
    'utf8',
  );
  const registered = toolEvidence.registration?.registered ?? [];
  const bootNote = boot.status === 0 ? 'boot=ok' : 'dispatch=unknown';
  console.log(`LIVE_CHECK_OK case=tools registration=${toolEvidence.registration?.status ?? 'unknown'} registered=${registered.length} schemas=${toolEvidence.schema_count} get=true ${bootNote} delivery=unknown`);
} else {
  if (!marker) fail('section_not_registered', { bootExit: boot.status });
  if (marker.name !== 'memsys:context' || Number(marker.order) !== 500) {
    fail('section_name_or_order_mismatch', { marker });
  }
  evidence.section = { ...marker, result: 'ok' };
  evidence.auto_inject = false;
  evidence.delivery = 'unknown';
  evidence.result = 'ok';
  evidence.status = 'passed';
  fs.mkdirSync(ARTIFACTS, { recursive: true });
  fs.writeFileSync(
    path.join(ARTIFACTS, `live-check-${CASE}.json`),
    `${JSON.stringify(evidence, null, 2)}\n`,
    'utf8',
  );
  console.log(
    `LIVE_CHECK_OK case=${CASE} plugin=loaded section=${marker.name} order=${marker.order} auto_inject=false delivery=unknown`,
  );
}

