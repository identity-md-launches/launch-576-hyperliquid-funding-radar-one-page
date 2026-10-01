export const HOURS_PER_YEAR = 24 * 365;

/** Percentage-valued fields are already multiplied by 100; fundingHourly is a decimal rate. */
export interface Market {
  coin: string;
  markPrice: number | null;
  change24h: number | null;
  fundingHourly: number | null;
  fundingApr: number | null;
  openInterestUsd: number | null;
  volume24hUsd: number | null;
  premium: number | null;
}

export interface FundingPoint { time: number; apr: number }
export interface PricePoint { time: number; close: number }
export interface MarketHistory {
  funding: FundingPoint[];
  candles: PricePoint[];
  fundingError: string | null;
  priceError: string | null;
}
export type SortKey = keyof Market;
export type SortDirection = 'asc' | 'desc';
export type FundingFilter = 'all' | 'positive' | 'negative';
export interface MarketFilters { query: string; minVolume: number; funding: FundingFilter }

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Missing, empty, infinite and malformed API values stay unknown, never become a false zero. */
export function finiteNumber(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function nonnegative(value: unknown): number | null {
  const number = finiteNumber(value);
  return number !== null && number >= 0 ? number : null;
}

export function hourlyToApr(rate: number): number {
  return rate * HOURS_PER_YEAR * 100;
}

export function parseMarkets(payload: unknown, allowEmpty = false): Market[] {
  if (!Array.isArray(payload) || payload.length !== 2 || !isRecord(payload[0]) ||
      !Array.isArray(payload[0].universe) || !Array.isArray(payload[1])) {
    throw new Error('Hyperliquid returned an unexpected market response. Please retry.');
  }
  const universe: unknown[] = payload[0].universe;
  const contexts: unknown[] = payload[1];
  if ((!universe.length && !allowEmpty) || universe.length !== contexts.length) {
    throw new Error('Hyperliquid returned incomplete market data. Please retry.');
  }
  const markets: Market[] = [];
  for (let index = 0; index < universe.length; index += 1) {
    const asset = universe[index];
    const context = contexts[index];
    if (!isRecord(asset) || typeof asset.name !== 'string' || !asset.name.trim()) {
      throw new Error('Hyperliquid returned invalid market metadata. Please retry.');
    }
    if (asset.isDelisted === true) continue;
    if (!isRecord(context)) {
      throw new Error('Hyperliquid returned incomplete market data. Please retry.');
    }
    const markPrice = nonnegative(context.markPx);
    const prevDayPrice = nonnegative(context.prevDayPx);
    const fundingHourly = finiteNumber(context.funding);
    const openInterest = nonnegative(context.openInterest);
    const premium = finiteNumber(context.premium);
    markets.push({
      coin: asset.name,
      markPrice,
      change24h: markPrice !== null && prevDayPrice !== null && prevDayPrice > 0
        ? finiteNumber((markPrice / prevDayPrice - 1) * 100) : null,
      fundingHourly,
      fundingApr: fundingHourly === null ? null : finiteNumber(hourlyToApr(fundingHourly)),
      openInterestUsd: openInterest !== null && markPrice !== null
        ? finiteNumber(openInterest * markPrice) : null,
      volume24hUsd: nonnegative(context.dayNtlVlm),
      premium: premium === null ? null : finiteNumber(premium * 100),
    });
  }
  if (!markets.length && !allowEmpty) throw new Error('Hyperliquid returned no active markets. Please retry.');
  return markets;
}

export function filterMarkets(markets: readonly Market[], filters: MarketFilters): Market[] {
  const query = filters.query.trim().toLocaleUpperCase('en-US');
  const minimum = Math.max(0, Number.isFinite(filters.minVolume) ? filters.minVolume : 0);
  return markets.filter((market) => {
    if (query && !market.coin.toLocaleUpperCase('en-US').includes(query)) return false;
    if (minimum > 0 && (market.volume24hUsd === null || market.volume24hUsd < minimum)) return false;
    if (filters.funding === 'positive' && !(market.fundingApr !== null && market.fundingApr > 0)) return false;
    if (filters.funding === 'negative' && !(market.fundingApr !== null && market.fundingApr < 0)) return false;
    return true;
  });
}

/** Unknown values sort last in either direction; coin breaks ties deterministically. */
export function sortMarkets(markets: readonly Market[], key: SortKey, direction: SortDirection): Market[] {
  const multiplier = direction === 'asc' ? 1 : -1;
  return [...markets].sort((a, b) => {
    const left = a[key];
    const right = b[key];
    if (left === null && right === null) return a.coin.localeCompare(b.coin, 'en');
    if (left === null) return 1;
    if (right === null) return -1;
    const comparison = typeof left === 'string' && typeof right === 'string'
      ? left.localeCompare(right, 'en') : Number(left) - Number(right);
    return comparison * multiplier || a.coin.localeCompare(b.coin, 'en');
  });
}

export function summarizeMarkets(markets: readonly Market[]) {
  return markets.reduce((summary, market) => ({
    openInterestUsd: summary.openInterestUsd + (market.openInterestUsd ?? 0),
    volume24hUsd: summary.volume24hUsd + (market.volume24hUsd ?? 0),
    above50: summary.above50 + (market.fundingApr !== null && market.fundingApr > 50 ? 1 : 0),
    belowNegative50: summary.belowNegative50 + (market.fundingApr !== null && market.fundingApr < -50 ? 1 : 0),
  }), { openInterestUsd: 0, volume24hUsd: 0, above50: 0, belowNegative50: 0 });
}

/** Rank the full active universe, independently of the current search and filters. */
export function rankFunding(markets: readonly Market[]): Map<string, 'top' | 'bottom'> {
  const ordered = sortMarkets(markets.filter((market) => market.fundingApr !== null), 'fundingApr', 'desc');
  const count = Math.min(5, Math.floor(ordered.length / 2));
  const ranks = new Map<string, 'top' | 'bottom'>();
  ordered.slice(0, count).forEach((market) => ranks.set(market.coin, 'top'));
  ordered.slice(-count || ordered.length).forEach((market) => ranks.set(market.coin, 'bottom'));
  return ranks;
}

export function formatPercent(value: number | null | undefined, decimals = 2, signed = true): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const rounded = Number(value.toFixed(decimals)) || 0;
  return `${signed && rounded > 0 ? '+' : ''}${rounded.toLocaleString('en-US', {
    minimumFractionDigits: decimals, maximumFractionDigits: decimals,
  })}%`;
}

export function formatUsd(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return value.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
}

export function formatPrice(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const digits = Math.abs(value) >= 1 ? 2 : Math.abs(value) >= 0.01 ? 4 : 8;
  if (value !== 0 && Math.abs(value) < 0.000001) {
    return `$${value.toLocaleString('en-US', { maximumSignificantDigits: 4 })}`;
  }
  return value.toLocaleString('en-US', {
    style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: digits,
  });
}

export function formatCompactUsd(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return value.toLocaleString('en-US', {
    style: 'currency', currency: 'USD', notation: 'compact', minimumFractionDigits: 2, maximumFractionDigits: 2,
  });
}
