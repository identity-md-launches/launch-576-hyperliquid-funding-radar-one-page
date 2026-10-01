import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { fetchMarkets } from './lib/api';
import { filterMarkets, sortMarkets, summarizeMarkets, rankFunding, formatCompactUsd, formatPrice, formatPercent } from './lib/market';
import type { Market, SortKey, FundingFilter } from './lib/market';
import { DetailPanel } from './DetailPanel';

const PAGE_SIZE = 20;
const COLUMNS: { key: SortKey; label: string; short: string }[] = [
  { key: 'coin', label: 'Market', short: 'Market' },
  { key: 'markPrice', label: 'Mark price', short: 'Mark price' },
  { key: 'change24h', label: '24h change', short: '24h change' },
  { key: 'fundingHourly', label: 'Funding / 1h', short: 'Funding / 1h' },
  { key: 'fundingApr', label: 'Funding APR', short: 'Funding APR' },
  { key: 'openInterestUsd', label: 'Open interest', short: 'Open interest' },
  { key: 'volume24hUsd', label: 'Volume / 24h', short: '24h volume' },
  { key: 'premium', label: 'Premium', short: 'Premium' },
];

export function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const paths: Record<string, React.ReactNode> = {
    radar: <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><path d="m12 12 7-7M12 1v2M1 12h2M12 21v2M21 12h2" /><circle cx="12" cy="12" r="1" /></>,
    search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4.5 4.5" /></>,
    refresh: <><path d="M20 7v5h-5M4 17v-5h5" /><path d="M6 6a8 8 0 0 1 13 3M5 15a8 8 0 0 0 13 3" /></>,
    sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M5 19l1.5-1.5M17.5 6.5 19 5" /></>,
    moon: <path d="M20 14a8.5 8.5 0 0 1-10-10 8.5 8.5 0 1 0 10 10Z" />,
    monitor: <><rect x="3" y="4" width="18" height="13" rx="2" /><path d="M8 21h8M12 17v4" /></>,
    arrow: <path d="M5 12h14m-5-5 5 5-5 5" />,
    bars: <><path d="M5 20v-7M12 20V4M19 20V9" /><path d="M3 20h18" /></>,
    trend: <><path d="m3 16 5-5 4 3 8-9M15 5h5v5" /></>,
    up: <path d="M12 20V4m-6 6 6-6 6 6" />,
    down: <path d="M12 4v16m-6-6 6 6 6-6" />,
    info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7v.1" /></>,
    chevron: <path d="m9 5 7 7-7 7" />,
    close: <path d="m6 6 12 12M6 18 18 6" />,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name] || paths.info}</svg>;
}

function useTheme() {
  const [preference, setPreference] = useState<'system' | 'dark' | 'light'>(() => {
    try { const stored = localStorage.getItem('hl-radar-theme'); return stored === 'dark' || stored === 'light' ? stored : 'system'; } catch { return 'system'; }
  });
  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: light)');
    const apply = () => {
      const theme = preference === 'system' ? (media.matches ? 'light' : 'dark') : preference;
      document.documentElement.dataset.theme = theme;
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#0d1114' : '#f4f6f5');
    };
    apply();
    media.addEventListener('change', apply);
    try { localStorage.setItem('hl-radar-theme', preference); } catch { /* Storage is optional. */ }
    return () => media.removeEventListener('change', apply);
  }, [preference]);
  return { preference, cycle: () => setPreference(preference === 'system' ? 'dark' : preference === 'dark' ? 'light' : 'system') };
}

function signedClass(value: number | null) { return value === null || value === 0 ? '' : value > 0 ? 'positive' : 'negative'; }
function Funding({ value }: { value: number | null }) {
  const intensity = value === null ? 0 : Math.min(Math.abs(value) / 200, 1);
  return <span className={`funding-value ${signedClass(value)}`} style={{ '--heat': `${5 + intensity * 17}%` } as CSSProperties}>{formatPercent(value, 2)}</span>;
}
function Coin({ market, rank, onSelect }: { market: Market; rank?: 'top' | 'bottom'; onSelect: () => void }) {
  const symbols: Record<string, string> = { BTC: '₿', ETH: 'Ξ', SOL: '◎', HYPE: 'H' };
  return <button className="coin-button" onClick={onSelect} aria-label={`View ${market.coin} details${rank ? (rank === "top" ? ", top five funding" : ", bottom five funding") : ""}`}>
    <span className="coin-avatar" aria-hidden="true">{symbols[market.coin] || (market.coin.split(':').pop() || market.coin).slice(0, 2)}</span>
    <span className="coin-name"><strong>{market.coin}</strong><span className="coin-sub">PERP {rank && <span className={`rank-badge ${rank}`}>{rank === 'top' ? '↑ Top 5' : '↓ Bottom 5'}</span>}</span></span>
    <span className="coin-arrow"><Icon name="chevron" size={14} /></span>
  </button>;
}

export default function App() {
  const [markets, setMarkets] = useState<Market[]>([]);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [minVolume, setMinVolume] = useState(1_000_000);
  const [funding, setFunding] = useState<FundingFilter>('all');
  const [sortKey, setSortKey] = useState<SortKey>('fundingApr');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);
  const [selectedCoin, setSelectedCoin] = useState<string | null>(null);
  const activeRequest = useRef<AbortController | null>(null);
  const theme = useTheme();

  const refresh = useCallback(async () => {
    if (activeRequest.current) return;
    const controller = new AbortController();
    activeRequest.current = controller;
    setBusy(true);
    try {
      const result = await fetchMarkets(controller.signal);
      if (controller.signal.aborted) return;
      setMarkets(result); setUpdatedAt(Date.now()); setNow(Date.now()); setError('');
    } catch (err) {
      if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'Unable to reach the Hyperliquid API.');
    } finally {
      if (activeRequest.current === controller) { activeRequest.current = null; setBusy(false); }
    }
  }, []);
  useEffect(() => {
    void refresh();
    const polling = window.setInterval(() => void refresh(), 30_000);
    const clock = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => { clearInterval(polling); clearInterval(clock); activeRequest.current?.abort(); activeRequest.current = null; };
  }, [refresh]);

  const summary = useMemo(() => summarizeMarkets(markets), [markets]);
  const ranks = useMemo(() => rankFunding(markets), [markets]);
  const filtered = useMemo(() => sortMarkets(filterMarkets(markets, { query, minVolume, funding }), sortKey, sortDirection), [markets, query, minVolume, funding, sortKey, sortDirection]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const rows = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const selected = markets.find(m => m.coin === selectedCoin);
  const age = updatedAt === null ? null : Math.max(0, Math.floor((now - updatedAt) / 1000));
  const stale = Boolean(error) || (age !== null && age > 60);
  const reset = () => { setQuery(''); setMinVolume(0); setFunding('all'); setPage(1); };
  const changeSort = (key: SortKey) => { setSortDirection(sortKey === key ? (sortDirection === 'desc' ? 'asc' : 'desc') : key === 'coin' ? 'asc' : 'desc'); setSortKey(key); setPage(1); };
  const marketValue = (m: Market, key: SortKey) => {
    switch (key) {
      case 'markPrice': return formatPrice(m.markPrice);
      case 'change24h': return <span className={signedClass(m.change24h)}>{formatPercent(m.change24h, 2)}</span>;
      case 'fundingHourly': return <span className={signedClass(m.fundingHourly)}>{formatPercent(m.fundingHourly === null ? null : m.fundingHourly * 100, 4)}</span>;
      case 'fundingApr': return <Funding value={m.fundingApr} />;
      case 'openInterestUsd': return formatCompactUsd(m.openInterestUsd);
      case 'volume24hUsd': return formatCompactUsd(m.volume24hUsd);
      case 'premium': return formatPercent(m.premium, 4);
      default: return m.coin;
    }
  };

  return <>
    <a className="skip-link" href="#markets">Skip to markets</a>
    <header className="site-header">
      <a className="brand" href="./" aria-label="hl-radar home"><span className="brand-mark"><Icon name="radar" size={27} /></span><span>hl<span className="brand-hyphen">-</span>radar<span className="brand-dot">.</span></span></a>
      <span className="header-divider" /><span className="header-label">Hyperliquid analytics</span>
      <div className="header-right"><span className="network-label"><span className="network-dot" /> Mainnet <span className="read-only">Read only</span></span><button className="theme-button" onClick={theme.cycle} aria-label={`Theme: ${theme.preference}. Switch to ${theme.preference === 'system' ? 'dark' : theme.preference === 'dark' ? 'light' : 'system'}`} title="Cycle system, dark, and light theme"><Icon name={theme.preference === 'system' ? 'monitor' : theme.preference === 'dark' ? 'moon' : 'sun'} /><span>{theme.preference[0].toUpperCase() + theme.preference.slice(1)}</span></button></div>
    </header>
    <main>
      <section className="intro" aria-labelledby="page-title">
        <div><div className="eyebrow"><span className="eyebrow-line" /> The perpetuals monitor</div><h1 id="page-title">Funding radar<span className="title-dot">.</span></h1><p>Find the extremes. See where the market leans.</p></div>
        <div className="update-controls"><div className={`update-status ${stale ? 'is-stale' : ''}`}><span className="status-dot" />{updatedAt ? stale ? 'Data stale' : 'Live market data' : busy ? 'Connecting to Hyperliquid' : 'API unavailable'}<span className="update-age">{age === null ? 'Refreshes every 30s' : `Updated ${age} s ago`}</span></div><button className="icon-button refresh-button" onClick={() => void refresh()} disabled={busy} aria-label="Refresh market data" title="Refresh market data"><Icon name="refresh" /></button></div>
      </section>
      <section className="summary-grid" aria-label="Market summary across all active perpetuals">
        <div className="summary-card"><div className="summary-label">Total open interest<Icon name="bars" /></div><div className="summary-value">{updatedAt ? formatCompactUsd(summary.openInterestUsd) : '—'}</div><div className="summary-foot">Across all active markets<span className="summary-unit">USD</span></div></div>
        <div className="summary-card"><div className="summary-label">24h trading volume<Icon name="trend" /></div><div className="summary-value">{updatedAt ? formatCompactUsd(summary.volume24hUsd) : '—'}</div><div className="summary-foot">Rolling 24-hour volume<span className="summary-unit">24H</span></div></div>
        <div className="summary-card"><div className="summary-label">Above +50% APR<Icon name="up" /></div><div className="summary-value positive">{updatedAt ? summary.above50 : '—'}<span>markets</span></div><div className="summary-foot"><span className="small-dot positive-dot" />Longs pay shorts</div></div>
        <div className="summary-card"><div className="summary-label">Below −50% APR<Icon name="down" /></div><div className="summary-value negative">{updatedAt ? summary.belowNegative50 : '—'}<span>markets</span></div><div className="summary-foot"><span className="small-dot negative-dot" />Shorts pay longs</div></div>
      </section>
      <section id="markets" className="market-section" aria-labelledby="market-heading" tabIndex={-1}>
        <div className="market-section-heading"><div className="market-title"><Icon name="radar" size={20} /><h2 id="market-heading">Perpetual markets</h2><span className="count-badge">{updatedAt ? markets.length : '—'}</span></div><span className="section-hint">Select a market to explore its 7-day history <Icon name="arrow" size={16} /></span></div>
        <div className="toolbar">
          <label className="search-field"><span className="field-label">Search markets</span><span className="input-shell"><Icon name="search" size={17} /><input type="search" placeholder="Search coin…" autoComplete="off" name="coin" value={query} onChange={e => { setQuery(e.target.value); setPage(1); }} /><span className="search-shortcut" aria-hidden="true">⌕</span></span></label>
          <label className="volume-field"><span className="field-label">Min. 24h volume</span><select value={minVolume} onChange={e => { setMinVolume(Number(e.target.value)); setPage(1); }}><option value="0">Any volume</option><option value="100000">$100K</option><option value="1000000">$1M</option><option value="10000000">$10M</option><option value="100000000">$100M</option></select></label>
          <fieldset className="funding-filter"><legend className="field-label">Funding direction</legend><div className="segmented">{(['all', 'positive', 'negative'] as const).map(value => <button key={value} className={funding === value ? 'selected' : ''} aria-pressed={funding === value} onClick={() => { setFunding(value); setPage(1); }}>{value === 'all' ? 'All funding' : <><span className={value === 'positive' ? 'positive' : 'negative'} aria-hidden="true">{value === 'positive' ? '+' : '−'}</span> {value === 'positive' ? 'Positive' : 'Negative'}</>}</button>)}</div></fieldset>
          <button className="reset-button" onClick={reset} disabled={!query && minVolume === 0 && funding === 'all'}>Clear filters</button>
        </div>
        <div className="mobile-sort"><label>Sort by <select value={sortKey} onChange={e => { setSortKey(e.target.value as SortKey); setPage(1); }}>{COLUMNS.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}</select></label><button className="icon-button" onClick={() => setSortDirection(d => d === 'desc' ? 'asc' : 'desc')} aria-label={`Sort ${sortDirection === 'desc' ? 'ascending' : 'descending'}`}><Icon name={sortDirection === 'desc' ? 'down' : 'up'} /></button></div>
        {error && <div className="error-banner" role="alert"><Icon name="info" /><div><strong>{updatedAt ? 'Market update failed. Showing the last successful data.' : 'Unable to load market data.'}</strong><p>{error} Check your connection and try again.</p></div><button className="secondary-button" onClick={() => void refresh()} disabled={busy}>{busy ? 'Retrying…' : 'Retry'}</button></div>}
        <div className="table-wrap">
          <table className="market-table"><caption className="sr-only">Hyperliquid perpetual markets. Funding is hourly, annualized APR is not compounded. Select a column heading to sort.</caption><thead><tr>{COLUMNS.map(c => <th scope="col" key={c.key} aria-sort={sortKey === c.key ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'}><button onClick={() => changeSort(c.key)} className={sortKey === c.key ? 'sort-active' : ''}>{c.label}<span className="sort-indicator" aria-hidden="true">{sortKey === c.key ? sortDirection === 'desc' ? '↓' : '↑' : '↕'}</span></button></th>)}</tr></thead><tbody>
            {rows.map(m => <tr key={m.coin}><td><Coin market={m} rank={ranks.get(m.coin)} onSelect={() => setSelectedCoin(m.coin)} /></td>{COLUMNS.slice(1).map(c => <td key={c.key} className={`number-cell ${c.key === 'fundingApr' ? 'apr-cell' : ''}`}><span title={typeof m[c.key] === 'number' ? String(m[c.key]) + (['markPrice','openInterestUsd','volume24hUsd'].includes(c.key) ? ' USD' : c.key === 'fundingHourly' ? ' hourly decimal rate' : '%') : undefined}>{marketValue(m, c.key)}</span></td>)}</tr>)}
          </tbody></table>
        </div>
        <div className="market-cards">{rows.map(m => <article key={m.coin} className="market-card"><div className="market-card-top"><Coin market={m} rank={ranks.get(m.coin)} onSelect={() => setSelectedCoin(m.coin)} /><div className="card-apr"><span className="field-label">Funding APR</span><Funding value={m.fundingApr} /></div></div><dl>{COLUMNS.filter(c => !['coin','fundingApr'].includes(c.key)).map(c => <div key={c.key}><dt>{c.short}</dt><dd>{marketValue(m,c.key)}</dd></div>)}</dl></article>)}</div>
        {!updatedAt && busy && <div className="loading-state" role="status"><div className="loading-caption"><Icon name="radar" />Loading live markets…</div>{Array.from({ length: 6 }, (_, i) => <div className="skeleton-row" key={i}><span /><span /><span /><span /><span /></div>)}</div>}
        {updatedAt && filtered.length === 0 && <div className="empty-state"><span className="empty-icon"><Icon name="search" size={26} /></span><h3>No matching markets</h3><p>{query ? `No coins match “${query}” with these filters.` : 'No markets match these volume and funding filters.'}</p><button className="primary-button" onClick={reset}>Clear filters</button></div>}
        <div className="table-footer"><span role="status">{updatedAt ? filtered.length ? <><span className="footer-strong">{(currentPage - 1) * PAGE_SIZE + 1}–{Math.min(currentPage * PAGE_SIZE, filtered.length)}</span> of {filtered.length} markets<span className="filtered-note"> · {markets.length} total</span></> : '0 matching markets' : busy ? 'Waiting for Hyperliquid…' : 'No data available'}</span><div className="pagination"><button className="page-button" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)} aria-label="Previous page">←</button><span>{currentPage} <span className="muted">/ {totalPages}</span></span><button className="page-button" disabled={currentPage >= totalPages} onClick={() => setPage(currentPage + 1)} aria-label="Next page">→</button></div></div>
      </section>
      <div className="legend-row"><div className="funding-legend"><span>Funding APR</span><span className="legend-scale" aria-hidden="true"><i /><i /><i /><i /><i /><i /><i /></span><span><span className="negative">− Shorts pay</span><span className="legend-divider">/</span><span className="positive">+ Longs pay</span></span></div><span className="extreme-legend">↑ Top 5 / ↓ Bottom 5 <span className="muted">ranked across all markets</span></span></div>
      <details className="methodology"><summary><Icon name="info" size={15} /> How to read the radar</summary><div className="methodology-copy"><p><strong>Funding APR = hourly funding rate × 24 × 365 × 100%.</strong> It is a simple annualized snapshot, not a forecast or a compounded yield. Positive funding means longs pay shorts; negative funding means shorts pay longs.</p><p>Open interest is token open interest × mark price. The 24h price change compares mark price with the previous day’s price. Premium is the API premium expressed as a percentage. “—” means data is unavailable.</p><p>Summary totals and top/bottom five ranks cover all active native and builder-deployed (HIP-3) perpetuals, before filters. Builder markets keep their exchange prefix, such as xyz:TSLA. Seven-day charts use hourly observations in UTC; newer markets can have shorter histories.</p></div></details>
    </main>
    <footer className="site-footer"><span><span className="footer-logo">hl-radar.</span> Data: Hyperliquid public API. Not financial advice.</span><span className="footer-right">All perpetuals<span className="footer-separator">/</span>30s refresh</span></footer>
    {selected && <DetailPanel key={selected.coin} market={selected} stale={stale} onClose={() => setSelectedCoin(null)} />}
  </>;
}
