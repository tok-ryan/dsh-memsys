import { DatabaseSync } from 'node:sqlite';

/** Wrap a function and count invocations, to assert "zero business writes". */
export function countCalls(fn) {
  function wrapped(...args) {
    wrapped.calls += 1;
    return fn(...args);
  }
  wrapped.calls = 0;
  return wrapped;
}

/** Readback that always reports unknown (hash mismatch / lock / timeout class). */
export function unknownReader(reason = 'simulated_unknown') {
  return () => ({ status: 'unknown', reason });
}

/** Readback that always reports missing (authoritative store confirms absence). */
export function missingReader() {
  return () => ({ status: 'missing', reason: 'simulated_missing' });
}

/** Readback that throws, which must be classified as unknown by the committer. */
export function throwingReader(message = 'simulated_read_error') {
  return () => {
    throw new Error(message);
  };
}

/** A control handle that is closed, so every ledger call fails. */
export function closedControl(config) {
  const db = new DatabaseSync(config.dbPaths.control);
  db.close();
  return db;
}
