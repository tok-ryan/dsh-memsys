#!/usr/bin/env node
/**
 * Child-process harness for M3 crash/concurrency proofs.
 *
 * Every "crash" is a real process exit at a named breakpoint; nothing relies on
 * closing a window or a sleep pretending to be a crash. Options are argv-only
 * so the parent controls the scenario explicitly.
 */
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const load = (relative) => import(pathToFileURL(path.join(ROOT, relative)).href);

function arg(name, fallback = null) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const scenario = arg('scenario');
const dataDir = arg('data-dir');
const stopAt = arg('stop-at');
const objectId = arg('object');
const requestKey = arg('request');
const marker = arg('marker');
const step = arg('step');
const messageSeq = Number(arg('message-seq', '1'));

if (!scenario || !dataDir) {
  console.error('USAGE: worker.mjs --scenario <name> --data-dir <dir> [--stop-at <point>]');
  process.exit(2);
}

const { resolveConfig } = await load('src/config.mjs');
const { openAll, closeAll } = await load('src/storage/open.mjs');
const { migrateAll } = await load('src/storage/migrate.mjs');
const { seedInitialRegistry, getObservation, insertObservation } = await load(
  'src/storage/repositories.mjs',
);
const { systemClock } = await load('src/clock.mjs');
const { commitControlled } = await load('src/control/commit.mjs');
const { reserveAttempt } = await load('src/control/ledger.mjs');
const { recoverAll } = await load('src/control/recovery.mjs');
const { readExactObservation } = await load('src/control/readback.mjs');
const { ingestInput } = await load('src/write/observe.mjs');
const { recordCandidates } = await load('src/write/candidate.mjs');
const { fakeRuntime } = await import('./runtime.mjs');

const config = resolveConfig({ dataDir: path.resolve(dataDir) });
const handles = openAll(config);
migrateAll(handles, { clock: systemClock });
handles.main.exec('BEGIN IMMEDIATE');
try {
  seedInitialRegistry(handles.main, systemClock);
  handles.main.exec('COMMIT');
} catch (err) {
  try {
    handles.main.exec('ROLLBACK');
  } catch {
    // keep original
  }
  throw err;
}
const deps = { main: handles.main, control: handles.control, clock: systemClock };
const runtime = fakeRuntime({ messageSeq });

function crash(point) {
  if (stopAt !== point) return false;
  // Hard exit at the breakpoint: no cleanup, no finally blocks.
  process.exit(0);
}

const commitHooks = {
  beforeReserve: () => crash('before_reserve'),
  afterReserve: () => crash('after_reserve'),
  afterWrite: () => crash('after_write'),
  afterRead: () => crash('after_read'),
  beforeControlComplete: () => crash('before_control_complete'),
  afterControlComplete: () => crash('after_control_complete'),
};

function print(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

try {
  switch (scenario) {
    case 'observe': {
      const result = ingestInput(
        runtime,
        { text: '崩溃点测试。', messageSeq },
        { ...deps, commitHooks },
      );
      print({ scenario, receipt: result.receipt.status, observations: countRows(handles.main, 'observations') });
      break;
    }
    case 'candidate': {
      const observed = ingestInput(runtime, { text: '候选崩溃测试。', messageSeq }, deps);
      const result = recordCandidates(
        runtime,
        {
          items: [
            {
              observationId: observed.observation.id,
              text: '候选崩溃',
              why: '测试',
              type: 'fact',
              evidenceRefs: [
                {
                  observationId: observed.observation.id,
                  sourceSpan: `bytes:0:${Buffer.byteLength(observed.observation.text, 'utf8')}`,
                },
              ],
            },
          ],
        },
        { ...deps, commitHooks },
      );
      print({ scenario, item: result.items[0]?.status ?? null });
      break;
    }
    case 'promote': {
      const observed = ingestInput(runtime, { text: '提升崩溃测试。', messageSeq }, deps);
      const result = recordCandidates(
        runtime,
        {
          items: [
            {
              observationId: observed.observation.id,
              text: '提升崩溃',
              why: '测试',
              type: 'fact',
              evidenceRefs: [
                {
                  observationId: observed.observation.id,
                  sourceSpan: `bytes:0:${Buffer.byteLength(observed.observation.text, 'utf8')}`,
                },
              ],
            },
          ],
        },
        {
          ...deps,
          faultInjector: {
            promoteHooks: {
              beforeStep(index) {
                if (step !== null && Number(step) === index) {
                  process.exit(0);
                }
              },
            },
          },
        },
      );
      print({ scenario, item: result.items[0]?.status ?? null });
      break;
    }
    case 'fail-once': {
      const spec = {
        objectKey: `main:${objectId}`,
        targetDb: 'main',
        requestKey,
        payloadHash: 'payload-hash-1',
        immutablePayload: '{"probe":1}',
        targetIds: [objectId],
        repair: false,
      };
      const receipt = commitControlled({
        control: handles.control,
        clock: systemClock,
        spec,
        writeTxn: () => {},
        readExact: () => ({ status: 'missing', reason: 'intentional' }),
      });
      const operation = handles.control
        .prepare('SELECT * FROM operations WHERE operation_id = ?')
        .get(receipt.operationId);
      print({
        scenario,
        status: receipt.status,
        failures: Number(operation.consecutive_failures),
        frozen: Number(operation.frozen) === 1,
      });
      break;
    }
    case 'commit-found': {
      const observation = {
        id: objectId,
        idempotency_key: `obs:child:${objectId}`,
        at: systemClock.at().at,
        payload_hash: 'payload-hash-1',
        text: '子进程写入',
        source: 'tool',
        author_kind: 'tool',
        runtime_refs: '{}',
        origin: 'observed@2026-11-03',
        lossy: 0,
        state_snapshot: '{}',
        initial_strength: 0.5,
        recorded_at: systemClock.at().at,
      };
      const spec = {
        objectKey: `main:${objectId}`,
        targetDb: 'main',
        requestKey,
        payloadHash: observation.payload_hash,
        immutablePayload: '{"probe":1}',
        targetIds: [objectId],
        repair: false,
      };
      const receipt = commitControlled({
        control: handles.control,
        clock: systemClock,
        spec,
        writeTxn: () => {
          if (!getObservation(handles.main, objectId)) insertObservation(handles.main, observation);
        },
        readExact: () => readExactObservation(handles.main, observation),
      });
      print({ scenario, status: receipt.status, failures: receipt.consecutiveFailures, frozen: receipt.frozen });
      break;
    }
    case 'hold-reserve': {
      const spec = {
        objectKey: `main:${objectId}`,
        targetDb: 'main',
        requestKey,
        payloadHash: 'payload-hash-1',
        immutablePayload: '{"probe":1}',
        targetIds: [objectId],
      };
      const reservation = reserveAttempt(handles.control, systemClock, spec);
      print({ scenario, reservation: reservation.attemptNo, operationId: reservation.operationId });
      if (marker) {
        const fs = await import('node:fs');
        fs.writeFileSync(marker, 'ready', 'utf8');
      }
      // Hold the in-flight attempt until the parent kills this process.
      setInterval(() => {}, 1000);
      break;
    }
    case 'try-reserve': {
      const spec = {
        objectKey: `main:${objectId}`,
        targetDb: 'main',
        requestKey,
        payloadHash: 'payload-hash-1',
        immutablePayload: '{"probe":1}',
        targetIds: [objectId],
      };
      try {
        const reservation = reserveAttempt(handles.control, systemClock, spec);
        print({ scenario, ok: true, attempt: reservation.attemptNo });
      } catch (err) {
        print({ scenario, ok: false, code: err.code ?? err.message });
      }
      break;
    }
    case 'recover': {
      const results = recoverAll({
        main: handles.main,
        control: handles.control,
        clock: systemClock,
      });
      print({ scenario, results });
      break;
    }
    case 'reconcile-frozen': {
      const { reconcileFrozenStreams } = await load('src/control/recovery.mjs');
      const results = reconcileFrozenStreams({
        main: handles.main,
        control: handles.control,
        clock: systemClock,
      });
      print({ scenario, results });
      break;
    }
    case 'lock': {
      const { acquireServiceLock } = await load('src/control/recovery.mjs');
      const result = acquireServiceLock({ dataDir: config.dataDir, clock: systemClock });
      print({ scenario, acquired: result.acquired, code: result.code ?? null });
      break;
    }
    default:
      console.error(`unknown scenario: ${scenario}`);
      process.exit(2);
  }
} finally {
  closeAll(handles);
}
