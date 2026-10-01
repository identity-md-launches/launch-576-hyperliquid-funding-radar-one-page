const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const build = process.env.HL_RADAR_TEST_BUILD;
if (!build) throw new Error('Run these checks with npm test.');
const market = require(path.join(build, 'market.js'));
const api = require(path.join(build, 'api.js'));

const rawContext = { markPx: '110', prevDayPx: '100', funding: '0.0001', openInterest: '20', dayNtlVlm: '2000000', premium: '-0.00025' };
function payload(context = rawContext) { return [{ universe: [{ name: 'BTC' }] }, [context]]; }
const btc = market.parseMarkets(payload())[0];
const row = (coin, fundingApr, volume24hUsd = 2000000) => ({ ...btc, coin, fundingApr, volume24hUsd });

test('normalizes API units for prices, APR, OI, volume and premium', () => {
  assert.equal(btc.markPrice, 110);
  assert.ok(Math.abs(btc.change24h - 10) < 1e-10);
  assert.equal(btc.fundingHourly, 0.0001);
  assert.ok(Math.abs(btc.fundingApr - 87.6) < 1e-10);
  assert.equal(btc.openInterestUsd, 2200);
  assert.equal(btc.volume24hUsd, 2000000);
  assert.equal(btc.premium, -0.025);
});

test('null, malformed and nonfinite values never become false zeroes', () => {
  for (const invalid of [null, undefined, '', ' ', 'NaN', 'Infinity', {}, true]) {
    assert.equal(market.finiteNumber(invalid), null);
  }
  const invalid = market.parseMarkets(payload({ ...rawContext, markPx: null, prevDayPx: '0', funding: 'bad', premium: null }))[0];
  assert.equal(invalid.markPrice, null);
  assert.equal(invalid.change24h, null);
  assert.equal(invalid.fundingApr, null);
  assert.equal(invalid.openInterestUsd, null);
  assert.equal(invalid.premium, null);
});

test('preserves active asset-context pairing when delisted metadata appears', () => {
  const data = [{ universe: [{ name: 'OLD', isDelisted: true }, { name: 'BTC' }] }, [{ ...rawContext, markPx: '2' }, rawContext]];
  assert.deepEqual(market.parseMarkets(data).map(m => [m.coin,m.markPrice]), [['BTC',110]]);
});

test('rejects malformed and incomplete universe responses', () => {
  for (const data of [null, {}, [], [{ universe: [] }, []], [{ universe: [{ name: 'BTC' }] }, []], [{ universe: [{ name: '' }] }, [{}]]]) {
    assert.throws(() => market.parseMarkets(data));
  }
});

test('search, volume and funding direction combine and are case insensitive', () => {
  const rows = [row('BTC', 20), row('WBTC', -90, 200000), row('ETH', 0), row('BTCDOM', -40)];
  const filter = { query: ' btc ', minVolume: 1000000, funding: 'negative' };
  assert.deepEqual(market.filterMarkets(rows, filter).map(m => m.coin), ['BTCDOM']);
  assert.deepEqual(market.filterMarkets(rows, { ...filter, minVolume: 0 }).map(m => m.coin), ['WBTC', 'BTCDOM']);
  assert.deepEqual(market.filterMarkets(rows, { query: '', minVolume: 0, funding: 'positive' }).map(m => m.coin), ['BTC']);
});

test('sorts every column in both directions without mutating source; missing values last', () => {
  const rows = [row('BTC', 20), row('ETH', null), row('ADA', -40)];
  const original = [...rows];
  for (const key of Object.keys(btc)) {
    for (const dir of ['asc', 'desc']) {
      const sorted = market.sortMarkets(rows, key, dir);
      assert.equal(sorted.length, 3);
    }
  }
  assert.deepEqual(market.sortMarkets(rows, 'fundingApr', 'asc').map(m => m.coin), ['ADA', 'BTC', 'ETH']);
  assert.deepEqual(market.sortMarkets(rows, 'fundingApr', 'desc').map(m => m.coin), ['BTC', 'ADA', 'ETH']);
  assert.deepEqual(rows, original);
});

test('summary thresholds are strict and totals use full supplied universe', () => {
  const rows = [row('A', 51), row('B', 50), row('C', -50), row('D', -51), row('E', null)];
  assert.deepEqual(market.summarizeMarkets(rows), { openInterestUsd: 11000, volume24hUsd: 10000000, above50: 1, belowNegative50: 1 });
});

test('top five and bottom five rank distinct global extremes', () => {
  const rows = Array.from({ length: 12 }, (_, i) => row(`C${i}`, i - 6));
  const rank = market.rankFunding(rows);
  assert.equal(rank.size, 10);
  assert.equal(rank.get('C0'), 'bottom');
  assert.equal(rank.get('C11'), 'top');
  assert.equal(rank.get('C6'), undefined);
  assert.equal(market.rankFunding([]).size, 0);
});

test('formatters retain sign, unavailable data and small price precision', () => {
  assert.equal(market.formatPercent(87.6), '+87.60%');
  assert.equal(market.formatPercent(-3.451), '-3.45%');
  assert.equal(market.formatPercent(-0.00001), '0.00%');
  assert.equal(market.formatPercent(null), '—');
  assert.equal(market.formatPrice(0.0000000123), '$0.0000000123');
  assert.equal(market.formatCompactUsd(1250000), '$1.25M');
});

test('browser request posts only public info endpoint with no credentials', async () => {
  const original = global.fetch;
  let observed;
  global.fetch = async (url, options) => {
    if (JSON.parse(options.body).type === 'perpDexs') return { ok: true, json: async () => [null] };
    observed = { url, options }; return { ok: true, json: async () => payload() };
  };
  try {
    assert.equal((await api.fetchMarkets())[0].coin, 'BTC');
    assert.equal(observed.url, 'https://api.hyperliquid.xyz/info');
    assert.equal(observed.options.method, 'POST');
    assert.equal(observed.options.credentials, 'omit');
    assert.deepEqual(JSON.parse(observed.options.body), { type: 'metaAndAssetCtxs' });
  } finally { global.fetch = original; }
});

test('HTTP, network and malformed JSON errors have useful messages', async () => {
  const original = global.fetch;
  try {
    global.fetch = async () => ({ ok: false, status: 429 });
    await assert.rejects(api.fetchMarkets(), /rate limiting/);
    global.fetch = async () => { throw new TypeError('Failed to fetch'); };
    await assert.rejects(api.fetchMarkets(), /Check your connection/);
    global.fetch = async () => ({ ok: true, json: async () => { throw new SyntaxError('no'); } });
    await assert.rejects(api.fetchMarkets(), /unreadable response/);
  } finally { global.fetch = original; }
});

test('aborted caller never starts a network request', async () => {
  const original = global.fetch;
  const controller = new AbortController();
  controller.abort();
  global.fetch = async () => assert.fail('must not start');
  try { await assert.rejects(api.fetchMarkets(controller.signal), { name: 'AbortError' }); }
  finally { global.fetch = original; }
});

test('timeout is reported as a retryable error, not a silent abort', async () => {
  const originalFetch = global.fetch;
  const originalTimer = global.setTimeout;
  global.setTimeout = (callback, delay) => originalTimer(callback, delay === 12000 ? 0 : delay);
  global.fetch = async (_, options) => new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(new DOMException('canceled', 'AbortError'))));
  try { await assert.rejects(api.fetchMarkets(), /12 seconds/); }
  finally { global.fetch = originalFetch; global.setTimeout = originalTimer; }
});

test('history requests seven days of hourly candles and funding, sorted and deduplicated', async () => {
  const original = global.fetch;
  const now = Date.now();
  const calls = [];
  global.fetch = async (_, options) => {
    const body = JSON.parse(options.body);
    calls.push(body);
    const data = body.type === 'fundingHistory'
      ? [{ coin: 'BTC', time: now - 1000, fundingRate: '.0001' }, { coin: 'BTC', time: now - 2000, fundingRate: '-.0001' }, { coin: 'BTC', time: now - 1000, fundingRate: '.0002' }]
      : [{ s: 'BTC', t: now - 1000, c: '110' }, { s: 'BTC', t: now - 2000, c: '100' }];
    return { ok: true, json: async () => data };
  };
  try {
    const result = await api.fetchMarketHistory('BTC');
    assert.equal(result.funding.length, 2);
    assert.ok(result.funding[0].apr < 0);
    assert.ok(result.funding[1].apr > 170);
    assert.equal(result.candles[0].close, 100);
    assert.equal(result.fundingError, null);
    assert.equal(result.priceError, null);
    assert.equal(calls[0].endTime - calls[0].startTime, 7 * 24 * 3600000);
    assert.equal(calls[1].req.interval, '1h');
  } finally { global.fetch = original; }
});

test('failed funding history retains available candle chart', async () => {
  const original = global.fetch;
  global.fetch = async (_, options) => {
    if (JSON.parse(options.body).type === 'fundingHistory') return { ok: false, status: 503 };
    return { ok: true, json: async () => [{ s: 'BTC', t: Date.now() - 3600000, c: '100' }] };
  };
  try {
    const result = await api.fetchMarketHistory('BTC');
    assert.equal(result.candles.length, 1);
    assert.equal(result.funding.length, 0);
    assert.match(result.fundingError, /503/);
    assert.equal(result.priceError, null);
  } finally { global.fetch = original; }
});

function freshApi() {
  delete require.cache[require.resolve(path.join(build, 'api.js'))];
  return require(path.join(build, 'api.js'));
}

test('discovers every DEX, deduplicates names, caches discovery and bounds request concurrency', async () => {
  const allApi = freshApi();
  const originalFetch = global.fetch;
  const originalNow = Date.now;
  let now = originalNow();
  Date.now = () => now;
  let discoveries = 0;
  let active = 0;
  let maximumActive = 0;
  const requests = [];
  const names = Array.from({ length: 10 }, (_, i) => `dex${i}`);
  global.fetch = async (_, options) => {
    const body = JSON.parse(options.body);
    if (body.type === 'perpDexs') {
      discoveries++;
      return { ok: true, json: async () => [null, ...names.map(name => ({ name })), { name: 'dex0' }] };
    }
    requests.push(body);
    active++;
    maximumActive = Math.max(maximumActive, active);
    await new Promise(resolve => setTimeout(resolve, 1));
    active--;
    return { ok: true, json: async () => [{ universe: [{ name: body.dex ? `${body.dex}:BTC` : 'BTC' }] }, [rawContext]] };
  };
  try {
    const result = await allApi.fetchMarkets();
    assert.equal(result.length, 11);
    assert.equal(new Set(result.map(m => m.coin)).size, 11);
    assert.equal(maximumActive, 4);
    assert.equal(requests.length, 11);
    assert.deepEqual(requests[0], { type: 'metaAndAssetCtxs' });
    assert.equal(result.at(-1).coin, 'dex9:BTC');
    await allApi.fetchMarkets();
    assert.equal(discoveries, 1);
    now += allApi.DEX_DISCOVERY_TTL + 1;
    await allApi.fetchMarkets();
    assert.equal(discoveries, 2);
  } finally { global.fetch = originalFetch; Date.now = originalNow; }
});

test('a DEX failure rejects the complete refresh instead of returning a partial market set', async () => {
  const allApi = freshApi();
  const original = global.fetch;
  global.fetch = async (_, options) => {
    const body = JSON.parse(options.body);
    if (body.type === 'perpDexs') return { ok: true, json: async () => [null, { name: 'xyz' }] };
    if (body.dex) return { ok: false, status: 503 };
    return { ok: true, json: async () => payload() };
  };
  try { await assert.rejects(allApi.fetchMarkets(), /503/); }
  finally { global.fetch = original; }
});

test('invalid discovery fails explicitly and does not cache incomplete coverage', async () => {
  const allApi = freshApi();
  const original = global.fetch;
  let calls = 0;
  global.fetch = async () => {
    calls++;
    return { ok: true, json: async () => [null, { name: 'xyz' }, { name: null }] };
  };
  try {
    await assert.rejects(allApi.fetchMarkets(), /incomplete market directory/);
    await assert.rejects(allApi.fetchMarkets(), /incomplete market directory/);
    assert.equal(calls, 2);
  } finally { global.fetch = original; }
});

test('DEXs without active markets are valid and delisted assets are excluded', async () => {
  const allApi = freshApi();
  const original = global.fetch;
  global.fetch = async (_, options) => {
    const body = JSON.parse(options.body);
    if (body.type === 'perpDexs') return { ok: true, json: async () => [null, { name: 'xyz' }, { name: 'empty' }] };
    if (body.dex === 'xyz') return { ok: true, json: async () => [{ universe: [{ name: 'xyz:OLD', isDelisted: true }] }, [rawContext]] };
    if (body.dex === 'empty') return { ok: true, json: async () => [{ universe: [] }, []] };
    return { ok: true, json: async () => payload() };
  };
  try { assert.deepEqual((await allApi.fetchMarkets()).map(m => m.coin), ['BTC']); }
  finally { global.fetch = original; }
});
