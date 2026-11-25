import test from 'node:test';
import assert from 'node:assert/strict';
import { loadFixtures, matchupPoster } from '../src/fixtures.js';
import { eventFrom } from '../src/index.js';
import { fetchApiSports, fetchPwhl } from '../src/metadata-sources.js';

test('fixture cache reuses the snapshot and retains fixtures after throttling', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response(null, { status: 503 }));
  const entries = new Map();
  const cache = {
    async match(request) { return entries.get(request.url)?.clone(); },
    async put(request, response) { entries.set(request.url, response.clone()); }
  };
  const now = Date.parse('2026-11-24T19:00:00Z');
  const options = { now, cache, origin: 'https://worker.test' };
  let calls = 0;
  let throttled = false;
  async function fetchJson(url) {
    calls++;
    if (url.includes('espn.com')) return { events: [] };
    if (throttled) throw new Error('HTTP 429');
    return { events: [{ idEvent: '1', strTimestamp: '2026-11-25T00:00:00Z', strHomeTeam: 'Toronto' }] };
  }
  const first = await loadFixtures({}, fetchJson, options);
  assert.equal(first.fixtures.filter(first.isUpcoming).length, 1);
  const originalCalls = calls;
  const second = await loadFixtures({}, fetchJson, { ...options, now: now + 60000 });
  assert.equal(second.cached, true);
  assert.equal(calls, originalCalls);
  throttled = true;
  const third = await loadFixtures({}, fetchJson, { ...options, now: now + 660000 });
  assert.equal(third.cached, false);
  assert.equal(third.usedStale, true);
  assert.equal(third.requests['429'], 20);
  assert.equal(third.fixtures.filter(third.isUpcoming).length, 1);
});

test('PWHL schedule uses official teams and artwork', async () => {
  const logo = 'https://res.cloudinary.com/pwhl-low/image/upload/v1/team.png'.replaceAll('/', '\\/');
  const game = {
    game_id: '123', date_played: '2026-11-25T00:00:00Z', game_status: '7:00 PM',
    home_team: { home_team_name: 'TORONTO SCEPTRES', home_team_logo: [{ secure_url: logo }] },
    visiting_team: { visiting_team_name: 'OTTAWA CHARGE', visiting_team_logo: [{ secure_url: logo }] }
  };
  const content = [{ schedule_block: { schedule: [{ games: [game] }] } }];
  const data = JSON.stringify({ props: { pageData: { content } } });
  const [row] = await fetchPwhl(async () => new Response(`<script id="vike_pageContext" type="application/json">${data}</script>`));
  assert.equal(row.strLeague, 'PWHL');
  assert.equal(row.strHomeTeam, 'Toronto Sceptres');
  assert.equal(row.strAwayTeam, 'Ottawa Charge');
  assert.match(row.strHomeTeamBadge, /w_240,h_240,c_limit,f_png/);
});

test('API-Sports uses its key only in the header and filters schedules', async () => {
  const hosts = [];
  const game = {
    fixture: { id: 1, date: '2026-11-24T19:00:00Z', status: { short: 'NS' } },
    league: { id: 39, name: 'Premier League' },
    teams: { home: { name: 'Arsenal' }, away: { name: 'Chelsea' } }
  };
  const result = await fetchApiSports('example-key', '2026-11-24', async (url, options) => {
    hosts.push(new URL(url).hostname);
    assert.equal(options.headers['x-apisports-key'], 'example-key');
    assert.equal(options.redirect, 'manual');
    assert.equal(url.includes('example-key'), false);
    return Response.json({ response: url.includes('/fixtures') ? [game, { ...game, league: { id: 999 } }] : [] });
  });
  assert.equal(hosts.length, 4);
  assert.equal(result.failed, false);
  assert.deepEqual(result.rows.map(row => row.strLeague), ['Premier League']);
});

test('artwork falls back to an addon logo if the metadata logo fails', async t => {
  const badge = 'https://a.espncdn.com/i/teamlogos/soccer/500/359.png';
  const source = eventFrom({
    id: 'game', name: 'Arsenal vs Chelsea', releaseInfo: 'LIVE', category: 'football',
    description: 'League: Premier League', team1: { name: 'Arsenal', logo: badge },
    team2: { name: 'Chelsea', logo: 'https://private.test/logo.png' }
  }, 'NUVIO');
  assert.equal(source.badgeA, badge);
  assert.equal(source.badgeB, '');
  const requested = [];
  t.mock.method(globalThis, 'fetch', async url => {
    requested.push(url);
    return url === badge
      ? new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/png' } })
      : new Response(null, { status: 404 });
  });
  const poster = await matchupPoster({
    teamA: source.teamA, teamB: source.teamB, competition: 'Premier League',
    badgeA: badge.replace('359', '123'), fallbackBadgeA: source.badgeA
  });
  assert.deepEqual(requested, [badge.replace('359', '123'), badge]);
  assert.match(await poster.text(), /data:image\/png;base64,AQID/);
});
