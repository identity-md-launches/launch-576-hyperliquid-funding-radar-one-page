import { useEffect, useId, useRef, useState } from 'react';
import type { PointerEvent } from 'react';
import { fetchMarketHistory } from './lib/api';
import type { FundingPoint, Market, PricePoint } from './lib/market';
import { formatPercent, formatPrice } from './lib/market';

interface DetailPanelProps {
  market: Market;
  onClose: () => void;
  stale?: boolean;
}

type History = Awaited<ReturnType<typeof fetchMarketHistory>>;
type ChartPoint = { time: number; value: number };

const formatApr = (value: number | null) => formatPercent(value, 2);
const dateTime = (time: number) => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' }).format(time);
const shortDate = (time: number) => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(time);
const direction = (value: number | null) => value === null || value === 0 ? '' : value > 0 ? 'positive' : 'negative';

function HistoryChart({ points, kind, coin }: { points: ChartPoint[]; kind: 'funding' | 'price'; coin: string }) {
  const id = useId();
  const chartRef = useRef<HTMLDivElement>(null);
  const [chartWidth, setChartWidth] = useState(540);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const isFunding = kind === 'funding';
  const formatValue = isFunding ? formatApr : formatPrice;
  const selected = Math.min(selectedIndex ?? points.length - 1, points.length - 1);
  const point = points[selected];
  const width = chartWidth;
  const height = 212;
  const left = 58;
  const right = width - 12;
  const top = 14;
  const bottom = height - 34;
  const observedMin = Math.min(...points.map((item) => item.value));
  const observedMax = Math.max(...points.map((item) => item.value));
  const rawMin = isFunding ? Math.min(0, observedMin) : observedMin;
  const rawMax = isFunding ? Math.max(0, observedMax) : observedMax;
  const span = rawMax - rawMin;
  const padding = span > 0 ? span * 0.12 : Math.max(Math.abs(rawMax) * 0.025, isFunding ? 1 : 0.000001);
  const min = rawMin - padding;
  const max = rawMax + padding;
  const firstTime = points[0].time;
  const lastTime = points[points.length - 1].time;
  const timeSpan = lastTime - firstTime;
  const x = (time: number) => timeSpan === 0 ? (left + right) / 2 : left + ((time - firstTime) / timeSpan) * (right - left);
  const y = (value: number) => bottom - ((value - min) / (max - min)) * (bottom - top);
  const barWidth = Math.max(1, Math.min(12, (right - left) / Math.max(points.length, 1) * 0.7));
  const path = points.map((item, index) => `${index === 0 ? 'M' : 'L'}${x(item.time).toFixed(2)},${y(item.value).toFixed(2)}`).join(' ');
  const tickValues = (isFunding ? [rawMax, 0, rawMin] : [rawMax, (rawMax + rawMin) / 2, rawMin]).filter((value, index, array) => array.indexOf(value) === index);
  const tickFormat = (value: number) => isFunding ? `${value > 0 ? '+' : ''}${new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(value)}%` : new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: value >= 1 ? 1 : 5 }).format(value);

  useEffect(() => {
    const element = chartRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width > 0) setChartWidth(Math.max(240, entry.contentRect.width));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  function selectPointer(event: PointerEvent<SVGSVGElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const position = ((event.clientX - rect.left) / rect.width) * width;
    const time = firstTime + Math.max(0, Math.min(1, (position - left) / (right - left))) * timeSpan;
    let nearest = 0;
    points.forEach((item, index) => {
      if (Math.abs(item.time - time) < Math.abs(points[nearest].time - time)) nearest = index;
    });
    setSelectedIndex(nearest);
  }

  return (
    <div className="chart-shell" ref={chartRef}>
      <div className="chart-readout">
        <span className="chart-date">{dateTime(point.time)} UTC</span>
        <output id={`${id}-value`} className={`chart-value ${isFunding ? direction(point.value) : ''}`} htmlFor={`${id}-range`} aria-live="off">{formatValue(point.value)}{isFunding ? ' APR' : ''}</output>
      </div>
      <svg className="chart-svg" viewBox={`0 0 ${width} ${height}`} role="img" aria-labelledby={`${id}-title ${id}-description`} onPointerMove={selectPointer} onPointerDown={selectPointer}>
        <title id={`${id}-title`}>{coin} {isFunding ? 'funding APR' : 'hourly closing price'} over the past 7 days</title>
        <desc id={`${id}-description`}>{points.length} observations. Lowest {formatValue(observedMin)}; highest {formatValue(observedMax)}. Use the labeled slider below to inspect each observation.</desc>
        {tickValues.map((value) => (
          <g key={value}>
            <line x1={left} x2={right} y1={y(value)} y2={y(value)} stroke={isFunding && value === 0 ? 'var(--muted)' : 'var(--line)'} strokeDasharray={isFunding && value === 0 ? undefined : '3 5'} />
            <text x={left - 8} y={y(value) + 4} textAnchor="end" fill="var(--muted)" fontSize="11">{tickFormat(value)}</text>
          </g>
        ))}
        {isFunding ? points.map((item, index) => (
          <rect key={`${item.time}-${index}`} x={x(item.time) - barWidth / 2} y={Math.min(y(item.value), y(0))} width={barWidth} height={Math.max(Math.abs(y(item.value) - y(0)), 1)} fill={item.value === 0 ? 'var(--muted)' : item.value > 0 ? 'var(--positive)' : 'var(--negative)'} opacity={selected === index ? 1 : 0.72} />
        )) : <path d={path} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />}
        <line x1={x(point.time)} x2={x(point.time)} y1={top} y2={bottom} stroke="var(--muted)" strokeDasharray="3 4" />
        {!isFunding && <circle cx={x(point.time)} cy={y(point.value)} r="3.5" fill="var(--accent)" />}
        <text x={left} y={height - 8} textAnchor="start" fill="var(--muted)" fontSize="11">{shortDate(firstTime)}</text>
        {timeSpan > 0 && <text x={(left + right) / 2} y={height - 8} textAnchor="middle" fill="var(--muted)" fontSize="11">{shortDate(firstTime + timeSpan / 2)}</text>}
        {timeSpan > 0 && <text x={right} y={height - 8} textAnchor="end" fill="var(--muted)" fontSize="11">{shortDate(lastTime)}</text>}
      </svg>
      <label className="chart-help" htmlFor={`${id}-range`}>Inspect {isFunding ? 'funding' : 'price'} history <span>← → arrow keys</span></label>
      <input className="chart-range" id={`${id}-range`} type="range" min="0" max={points.length - 1} step="1" value={selected} onChange={(event) => setSelectedIndex(Number(event.target.value))} aria-valuetext={`${dateTime(point.time)} UTC, ${formatValue(point.value)}${isFunding ? ' APR' : ''}`} />
    </div>
  );
}

function FundingChart({ points, coin }: { points: FundingPoint[]; coin: string }) {
  return <HistoryChart points={points.map((point) => ({ time: point.time, value: point.apr }))} kind="funding" coin={coin} />;
}

function PriceChart({ points, coin }: { points: PricePoint[]; coin: string }) {
  return <HistoryChart points={points.map((point) => ({ time: point.time, value: point.close }))} kind="price" coin={coin} />;
}

export function DetailPanel({ market, onClose, stale = false }: DetailPanelProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [history, setHistory] = useState<History | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const titleId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog?.showModal();
    return () => {
      dialog?.close();
      if (trigger?.isConnected) trigger.focus({ preventScroll: true });
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setHistory(null);
    fetchMarketHistory(market.coin, controller.signal)
      .then((result) => { if (!controller.signal.aborted) setHistory(result); })
      .catch(() => { if (!controller.signal.aborted) setError('Hyperliquid did not return history. Check your connection and try again.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [market.coin, attempt]);

  const averageApr = history?.funding.length ? history.funding.reduce((total, point) => total + point.apr, 0) / history.funding.length : null;
  const retry = () => setAttempt((value) => value + 1);
  const hasError = Boolean(error || history?.fundingError || history?.priceError);

  return (
    <dialog ref={dialogRef} className="detail-panel" aria-labelledby={titleId} onCancel={(event) => { event.preventDefault(); onClose(); }} onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="detail-inner">
        <header className="detail-header">
          <div className="detail-heading">
            <p className="detail-kicker">Market detail · 7 days</p>
            <h2 id={titleId} className="detail-coin">{market.coin}<span> / USD</span></h2>
          </div>
          <button type="button" className="detail-close" onClick={onClose} aria-label={`Close ${market.coin} detail`}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
          </button>
        </header>

        {stale && <p className="detail-error" role="status">Market data is stale. Current price and APR show the last successful update.</p>}
        <dl className="detail-summary">
          <div className="detail-stat"><dt className="stat-label">Mark price</dt><dd className="stat-value">{formatPrice(market.markPrice)}</dd></div>
          <div className="detail-stat"><dt className="stat-label">Current funding APR</dt><dd className={`stat-value ${direction(market.fundingApr)}`}>{formatApr(market.fundingApr)}</dd></div>
          <div className="detail-stat"><dt className="stat-label">7-day average APR</dt><dd className={`stat-value ${direction(averageApr)}`}>{loading ? 'Loading…' : formatApr(averageApr)}</dd></div>
        </dl>
        <p className="detail-note">{market.fundingApr === null ? 'Current funding is unavailable.' : market.fundingApr > 0 ? 'Positive funding: longs pay shorts.' : market.fundingApr < 0 ? 'Negative funding: shorts pay longs.' : 'Current funding is zero.'} APR is hourly funding × 24 × 365, without compounding.</p>

        <div className="detail-content" aria-busy={loading}>
          <div className="chart-status" role="status">{loading ? 'Loading 7-day market history…' : ''}</div>
          {error && <p className="detail-error" role="alert">{error}</p>}
          {!loading && !error && history && <>
            <section className="chart-section" aria-labelledby={`${titleId}-funding`}>
              <div className="chart-heading"><h3 id={`${titleId}-funding`} className="chart-title">Funding history</h3><span className="chart-meta">APR · Hourly</span></div>
              {history.fundingError ? <p className="detail-error" role="alert">Funding history is unavailable. {history.fundingError}</p> : history.funding.length ? <FundingChart points={history.funding} coin={market.coin} /> : <p className="chart-status">No funding observations for {market.coin} in the past 7 days.</p>}
            </section>
            <section className="chart-section" aria-labelledby={`${titleId}-price`}>
              <div className="chart-heading"><h3 id={`${titleId}-price`} className="chart-title">Price history</h3><span className="chart-meta">USD · 1h close</span></div>
              {history.priceError ? <p className="detail-error" role="alert">Price history is unavailable. {history.priceError}</p> : history.candles.length ? <PriceChart points={history.candles} coin={market.coin} /> : <p className="chart-status">No hourly candles for {market.coin} in the past 7 days.</p>}
            </section>
          </>}
          {!loading && hasError && <button type="button" className="detail-retry" onClick={retry}>Retry history</button>}
        </div>
        <footer className="detail-footer">Times shown in UTC. Average uses available hourly observations. Historical funding does not predict future returns.</footer>
      </div>
    </dialog>
  );
}
