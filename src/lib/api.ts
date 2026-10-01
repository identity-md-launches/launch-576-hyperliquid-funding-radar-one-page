import { finiteNumber, hourlyToApr, isRecord, parseMarkets } from './market';
import type { FundingPoint, Market, MarketHistory, PricePoint } from './market';

export const API_URL = 'https://api.hyperliquid.xyz/info';
export const REFRESH_INTERVAL = 30_000;
export const REQUEST_TIMEOUT = 12_000;
export const HISTORY_WINDOW = 7 * 24 * 60 * 60 * 1000;
export const DEX_DISCOVERY_TTL = 5 * 60 * 1000;
const MARKET_CONCURRENCY = 4;
let dexCache: { names: string[]; expiresAt: number } | null = null;

function abortError(): DOMException {
  return new DOMException('The request was canceled.', 'AbortError');
}

/** The browser connects directly to the sole data source; no proxy, keys or storage. */
async function request(body: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
  if (signal?.aborted) throw abortError();
  const controller = new AbortController();
  let timedOut = false;
  const cancel = () => controller.abort();
  signal?.addEventListener('abort', cancel, { once: true });
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, REQUEST_TIMEOUT);
  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
      credentials: 'omit',
    });
    if (!response.ok) {
      throw new Error(response.status === 429
        ? 'Hyperliquid is rate limiting requests. Please wait a moment and retry.'
        : `Hyperliquid is unavailable (HTTP ${response.status}). Please retry.`);
    }
    try {
      return await response.json();
    } catch {
      if (controller.signal.aborted) throw abortError();
      throw new Error('Hyperliquid returned an unreadable response. Please retry.');
    }
  } catch (error) {
    if (signal?.aborted) throw abortError();
    if (timedOut) throw new Error('Hyperliquid did not respond within 12 seconds. Please retry.');
    if (error instanceof TypeError) {
      throw new Error('Cannot reach Hyperliquid. Check your connection and retry.');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', cancel);
  }
}

/** Discover HIP-3 DEXs too; a failed discovery must never quietly narrow the universe. */
async function discoverDexes(signal?: AbortSignal): Promise<string[]> {
  if (signal?.aborted) throw abortError();
  if (dexCache && Date.now() < dexCache.expiresAt) return dexCache.names;
  const payload = await request({ type: 'perpDexs' }, signal);
  if (!Array.isArray(payload)) throw new Error('Hyperliquid returned an unexpected market directory. Please retry.');
  const names = new Set<string>();
  for (const dex of payload) {
    // The null entry represents the native perp DEX, requested separately below.
    if (dex === null) continue;
    if (!isRecord(dex) || typeof dex.name !== 'string' || !dex.name.trim()) {
      throw new Error('Hyperliquid returned an incomplete market directory. Please retry.');
    }
    names.add(dex.name);
  }
  const discovered = [...names];
  dexCache = { names: discovered, expiresAt: Date.now() + DEX_DISCOVERY_TTL };
  return discovered;
}

/**
 * Fetch every active native and builder-deployed perpetual with at most four requests in flight.
 * The refresh is atomic: if any DEX fails, the UI retains its last complete successful snapshot.
 */
export async function fetchMarkets(signal?: AbortSignal): Promise<Market[]> {
  if (signal?.aborted) throw abortError();
  const controller = new AbortController();
  const cancel = () => controller.abort();
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    const dexes = ['', ...await discoverDexes(controller.signal)];
    const results: Market[][] = new Array(dexes.length);
    let next = 0;
    let failure: unknown;
    await Promise.all(Array.from({ length: Math.min(MARKET_CONCURRENCY, dexes.length) }, async () => {
      while (next < dexes.length && !controller.signal.aborted) {
        const index = next++;
        const dex = dexes[index];
        try {
          const body = dex ? { type: 'metaAndAssetCtxs', dex } : { type: 'metaAndAssetCtxs' };
          results[index] = parseMarkets(await request(body, controller.signal), Boolean(dex));
        } catch (error) {
          if (failure === undefined) failure = error;
          controller.abort();
        }
      }
    }));
    if (signal?.aborted) throw abortError();
    if (failure !== undefined) throw failure;
    const uniqueMarkets = new Map<string, Market>();
    for (const markets of results) {
      for (const market of markets) {
        if (!uniqueMarkets.has(market.coin)) uniqueMarkets.set(market.coin, market);
      }
    }
    return [...uniqueMarkets.values()];
  } finally {
    signal?.removeEventListener('abort', cancel);
  }
}

function parseFunding(payload: unknown, coin: string, start: number, end: number): FundingPoint[] {
  if (!Array.isArray(payload)) throw new Error('Funding history returned an unexpected response.');
  const values = new Map<number, FundingPoint>();
  for (const item of payload) {
    if (!isRecord(item) || (item.coin !== undefined && item.coin !== coin)) continue;
    const time = finiteNumber(item.time);
    const rate = finiteNumber(item.fundingRate);
    if (time !== null && rate !== null && time >= start && time <= end && Number.isFinite(hourlyToApr(rate))) {
      values.set(time, { time, apr: hourlyToApr(rate) });
    }
  }
  if (payload.length && !values.size) throw new Error('No valid funding observations were returned for this period.');
  return [...values.values()].sort((a, b) => a.time - b.time);
}

function parseCandles(payload: unknown, coin: string, start: number, end: number): PricePoint[] {
  if (!Array.isArray(payload)) throw new Error('Price history returned an unexpected response.');
  const values = new Map<number, PricePoint>();
  for (const item of payload) {
    if (!isRecord(item) || (item.s !== undefined && item.s !== coin)) continue;
    const time = finiteNumber(item.t);
    const close = finiteNumber(item.c);
    if (time !== null && close !== null && close > 0 && time >= start && time <= end) {
      values.set(time, { time, close });
    }
  }
  if (payload.length && !values.size) throw new Error('No valid price candles were returned for this period.');
  return [...values.values()].sort((a, b) => a.time - b.time);
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : 'History is unavailable. Please retry.';
}

/** Seven days fits in both endpoints' limits; partial failures retain the available chart. */
export async function fetchMarketHistory(coin: string, signal?: AbortSignal): Promise<MarketHistory> {
  const endTime = Date.now();
  const startTime = endTime - HISTORY_WINDOW;
  const [funding, candles] = await Promise.allSettled([
    request({ type: 'fundingHistory', coin, startTime, endTime }, signal)
      .then((payload) => parseFunding(payload, coin, startTime, endTime)),
    request({ type: 'candleSnapshot', req: { coin, interval: '1h', startTime, endTime } }, signal)
      .then((payload) => parseCandles(payload, coin, startTime, endTime)),
  ]);
  if (signal?.aborted) throw abortError();
  return {
    funding: funding.status === 'fulfilled' ? funding.value : [],
    candles: candles.status === 'fulfilled' ? candles.value : [],
    fundingError: funding.status === 'rejected' ? errorMessage(funding.reason) : null,
    priceError: candles.status === 'rejected' ? errorMessage(candles.reason) : null,
  };
}
