// Small request helpers shared by AgriEye adapters: bounded time, caller
// cancellation, and a session cache so revisiting a state costs no requests.

const memory = new Map();
const STORAGE_PREFIX = 'agrieye:v1:';

function readStored(key) {
  try {
    const raw = globalThis.sessionStorage?.getItem(STORAGE_PREFIX + key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeStored(key, entry) {
  try {
    globalThis.sessionStorage?.setItem(
      STORAGE_PREFIX + key,
      JSON.stringify(entry),
    );
  } catch {
    /* Quota or privacy mode: the memory cache still works. */
  }
}

/**
 * Return a cached value while fresh; otherwise load, store and return it.
 * When loading fails and an expired entry exists, it is returned with
 * `stale: true` so callers can say so instead of hiding the failure.
 * @template T
 * @param {string} key
 * @param {number} ttlMs
 * @param {() => Promise<T>} load
 * @param {{persist?: boolean, now?: () => number}} [options]
 * @returns {Promise<{value: T, fetchedAt: number, stale: boolean}>}
 */
export async function cached(key, ttlMs, load, { persist = true, now = Date.now } = {}) {
  let entry = memory.get(key) || (persist ? readStored(key) : null);
  if (entry && now() - entry.fetchedAt < ttlMs)
    return { value: entry.value, fetchedAt: entry.fetchedAt, stale: false };
  const pending = memory.get(`pending:${key}`);
  if (pending) return pending;
  const promise = (async () => {
    try {
      const value = await load();
      entry = { value, fetchedAt: now() };
      memory.set(key, entry);
      if (persist) writeStored(key, entry);
      return { value, fetchedAt: entry.fetchedAt, stale: false };
    } catch (error) {
      if (entry) return { value: entry.value, fetchedAt: entry.fetchedAt, stale: true, error };
      throw error;
    } finally {
      memory.delete(`pending:${key}`);
    }
  })();
  memory.set(`pending:${key}`, promise);
  return promise;
}

/** Fetch with a timeout, joined to an optional caller signal. */
export async function fetchWithTimeout(url, { signal, timeoutMs = 20_000, ...init } = {}) {
  const combined = AbortSignal.any(
    [signal, AbortSignal.timeout(timeoutMs)].filter(Boolean),
  );
  const response = await fetch(url, { ...init, signal: combined });
  if (!response.ok) {
    const error = new Error(`HTTP ${response.status} from ${new URL(url).host}`);
    error.status = response.status;
    throw error;
  }
  return response;
}

export async function fetchJson(url, options) {
  return (await fetchWithTimeout(url, options)).json();
}

/** Run async jobs with bounded concurrency, preserving input order. */
export async function mapLimit(items, limit, job) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next++;
      try {
        results[index] = { ok: true, value: await job(items[index], index) };
      } catch (error) {
        results[index] = { ok: false, error };
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
  return results;
}
