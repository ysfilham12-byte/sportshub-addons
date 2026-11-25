import { loadFixtures, matchupPoster, publicBadge } from './fixtures.js';
import { rankStreams } from './stream-quality.js';
import { classifyLanguage, streamLanguageAllowed } from './stream-language.js';
import { catalogs, enabledCatalogs, sports } from '../docs/catalogs.js';

const SPORTS = sports.map(([id, name]) => [id, name]);
const SPORT_ICONS = Object.fromEntries(sports.map(([id, , icon]) => [id, icon]));
const PROVIDER_LABELS = { NUVIO: 'Nuvio', HIGHFLY: 'HighFly', CNC: 'CNCVerse', PP: 'PenguPlay' };
const PROVIDERS = [
  { key: 'NUVIO', env: 'NUVIO_MANIFEST_URL', catalog: 'nuvio_sports_live', type: 'tv' },
  { key: 'HIGHFLY', env: 'HIGHFLY_MANIFEST_URL', catalog: 'sports_live', type: 'sport' },
  { key: 'CNC', env: 'CNC_MANIFEST_URL', catalog: 'cnc_SportzXLiveEvents_tv', type: 'tv' }
];
const AIO_PROVIDERS = [...PROVIDERS, { key: 'PP', catalog: 'pp-live-now', type: 'tv' }];
const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, OPTIONS', 'access-control-allow-headers': 'Content-Type' };
const norm = s => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/&/g, ' and ').replace(/\b(fc|cf|sc|ac|bc|wfc|afc|club)\b/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
const cleanName = s => String(s ?? '').replace(/^\s*(?:🔴|🟢|🔜|✅|🏆)+\s*/, '').replace(/^LIVE\s*:\s*/i, '').trim();
const query = url => { try { return new URL(url).searchParams; } catch { return new URLSearchParams(); } };
const arr = v => Array.isArray(v) ? v : [];
const decodeCnc = id => {
  if (!String(id).startsWith('cnc:')) return null;
  try { const raw = id.slice(4).replace(/-/g, '+').replace(/_/g, '/'); const padded = raw + '='.repeat((4 - raw.length % 4) % 4); return JSON.parse(atob(padded)); } catch { return null; }
};
function sportFrom(item, provider, cnc) {
  const posterCat = query(item.poster || item.background || '').get('cat') || '';
  const category = [posterCat, item.category, item.eventCat, cnc?.eventInfo?.eventCat, ...arr(item.genres)].join(' ').toLowerCase();
  const details = [item.league,item.competition,item.tournament,cnc?.eventInfo?.league,cnc?.eventInfo?.competition,cnc?.eventInfo?.eventName,item.name,item.title,item.description].join(' ').toLowerCase();
  const all = `${category} ${details}`;
  const rugbyLabel = [category, item.league, item.competition, item.tournament, item.name, item.title,
    cnc?.eventInfo?.league, cnc?.eventInfo?.competition].join(' ').toLowerCase();
  if (!/\bhandball\b/.test(category) && /\brugby\b|\bsix nations\b/.test(rugbyLabel)) return 'rugby';
  // Specific American football clues override ambiguous provider category 'football'.
  if (/american[ -]football|national football league|\bnfl\b|\bncaa\s*(?:football|fb|cfb)\b|college football|\bcfl\b|\b(xfl|ufl|usfl)\b/.test(all)) return 'football';
  if (/\bwnba\b|\bnba\b|basketball|\bncaab\b|college hoops|march madness|euroleague|\bfiba\b/.test(all)) return 'basketball';
  if (/\bpwhl\b|\bnhl\b|ice hockey|hockey|\bkhl\b|\bahl\b/.test(all)) return 'hockey';
  if (/\bmlb\b|baseball|world baseball classic|\bnpb\b|\bkbo\b/.test(all)) return 'baseball';
  if (/\bufc\b|\bmma\b|boxing|fight night|\bone championship\b|\bpfl\b/.test(all)) return 'mma';
  if (/tennis|\batp\b|\bwta\b|wimbledon/.test(all)) return 'tennis';
  if (/motorsport|formula ?1|\bf1\b|moto\s?gp|nascar/.test(all)) return 'motorsport';
  if (/soccer|football|premier league|champions league|bundesliga|la liga|serie a|ligue 1/.test(all)) return 'soccer';
  return 'other';
}
const MAJOR_BASKETBALL = /\bnba\b|\bwnba\b|national basketball association|\bncaa\b|\bncaab\b|college basketball|march madness|\bacc\b|\bbig (?:ten|12|east)\b|\bsec\b|\bpac[- ]?12\b/;
const MAJOR_FOOTBALL = /\bnfl\b|national football league|\bncaa\b|college football|\bcfb\b|\bfbs\b|college football playoff|\bcfp\b|\bbig (?:ten|12)\b|\bsec\b|\bacc\b|\bpac[- ]?12\b/;
const EXCLUDED_BASKETBALL = /euroleague|eurocup|\bfiba\b|\bacb\b|liga endesa|\bnbl\b|\bcba\b|\bbl\b|\blnb\b|\bleg[a]? basket\b|\bgleague\b|g league|development league|high school|\bu\s?1[6789]\b|under[- ]?1[6789]/;
const EXCLUDED_FOOTBALL = /\bcfl\b|canadian football|\b(xfl|ufl|usfl)\b|european league of football|\belf\b|arena football|indoor football|high school|\bfcs\b|division ii|division iii/;
const TOP_SOCCER = /^(?:(?:english |england )?premier league|epl|(?:spanish |spain )?la ?liga|(?:italian |italy )?serie a|(?:german |germany )?bundesliga|(?:french |france )?ligue 1|(?:english )?fa cup|copa del rey|dfb pokal|coppa italia|coupe de france|(?:uefa )?(?:champions league|europa league|european championship|euro(?: 20\d{2})?)|(?:fifa )?(?:world cup|club world cup)(?: 20\d{2})?|(?:conmebol )?(?:copa america|copa libertadores))$/;
function eligibleEvent(sport, item, cnc, competition) {
  const info = cnc?.eventInfo || {};
  const label = [competition,item.category,item.league,item.tournament,item.competition,item.eventCat,info.eventCat,info.eventName,item.name,item.title,item.description].join(' ').toLowerCase();
  if (sport === 'soccer') return TOP_SOCCER.test(String(competition || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim());
  if (sport === 'basketball') return !EXCLUDED_BASKETBALL.test(label) && MAJOR_BASKETBALL.test(label);
  if (sport === 'football') return !EXCLUDED_FOOTBALL.test(label) && MAJOR_FOOTBALL.test(label);
  if (sport === 'tennis') return /grand slam|australian open|roland garros|french open|wimbledon|us open|\batp\b|\bwta\b|masters|davis cup|billie jean king cup|olympic/.test(label);
  if (sport === 'motorsport') return /formula ?1|\bf1\b|moto\s?gp|nascar|grand prix/.test(label) && !/formula ?2|formula ?3|\bf2\b|\bf3\b/.test(label);
  if (sport === 'other') return !/cricket|\bipl\b|\bt20\b|test match|soccer|football/.test(label);
  return true;
}
function isPromo(item) {
  if (/\b(?:highlights?|full (?:match|game) replay)\b/i.test(`${item?.name || ''} ${item?.title || ''}`)) return true;
  const s = `${item?.name || ''} ${item?.title || ''} ${item?.description || ''} ${item?.externalUrl || ''}`.toLowerCase();
  const nonSportProgramming = /\b(game show|quiz show|reality show|talk show|soap opera|news bulletin|weather forecast)\b|kaun banega crorepati/i;
  return !!item?.externalUrl || nonSportProgramming.test(s) || /donat|support us|upgrade|subscribe now|premium access|subscription expired|how to watch|instructions|health check|google\.com/.test(s);
}
function competitionFrom(item, cnc) {
  const info = cnc?.eventInfo || {};
  const direct = [info.competition, info.competitionName, info.tournament, info.league, item.competition, item.tournament, item.league]
    .find(v => typeof v === 'string' && v.trim());
  if (direct) return direct.trim();
  const description = String(item.description || '');
  const match = description.match(/(?:^|\n)\s*(?:league|competition|tournament)\s*:\s*([^\n]+)/i);
  return match?.[1]?.trim() || '';
}
function displayEventName(title, teamA, teamB) {
  if (teamA && teamB) return `${cleanName(teamA)} vs ${cleanName(teamB)}`;
  return cleanName(title) || 'Live sports event';
}
function cleanEventDescription(sport, competition, teamA, teamB) {
  const sportName = SPORTS.find(x => x[0] === sport)?.[1] || 'Other Sports';
  const lines = ['🔴 LIVE NOW', `Sport: ${sportName}`];
  if (competition) lines.push(`Competition: ${competition}`);
  if (teamA && teamB) lines.push(`Match: ${teamA} vs ${teamB}`);
  return lines.join('\n');
}
function eventFrom(item, provider, filter = true) {
  if (!item || isPromo(item)) return null;
  const id = String(item.id || '');
  let cnc = null;
  let live = false;
  let channel = false;
  if (provider === 'NUVIO') {
    channel = id.includes('_ch_') || arr(item.genres).some(x => String(x).toUpperCase() === 'NETWORKS');
    const poster = query(item.poster || '');
    const status = `${item.releaseInfo || ''} ${item.name || ''} ${item.description || ''}`.toLowerCase();
    live = /live/.test(status) && !/subscription expired|not live/.test(status) || poster.get('st') === 'live';
  } else if (provider === 'HIGHFLY') {
    const streamedEvent = id.startsWith('streamed:');
    channel = id.startsWith('leaf:') || (!item.category && !streamedEvent);
    live = !channel && (String(item.releaseInfo || '').toUpperCase() === 'LIVE' || streamedEvent);
  } else if (provider === 'CNC') {
    cnc = decodeCnc(id);
    const p = query(item.poster || cnc?.poster || '');
    live = p.get('isLive') === 'true' && p.get('isEnded') !== 'true';
    channel = !id.startsWith('cnc:');
  } else if (provider === 'PP') {
    live = id.startsWith('pp-live:') && /^\s*(?:🔴\s*)?live\s*:/i.test(item.name);
  }
  if (!live || channel) return null;
  const title = cleanName(item.name || item.title || cnc?.title || cnc?.eventInfo?.eventName);
  const info = cnc?.eventInfo || {};
  const poster = provider === 'CNC' ? query(item.poster || cnc?.poster) : null;
  const teams = provider === 'CNC' ? [info.teamA || poster.get('teamA'), info.teamB || poster.get('teamB')] : arr(item.cast).filter(Boolean).slice(0, 2);
  const parsed = title.split(/\s+(?:vs\.?|v\.?|@)\s+/i).map(x => x.trim());
  const teamA = teams[0] || item.team1?.name || parsed[0] || '';
  const teamB = teams[1] || item.team2?.name || parsed[1] || '';
  if (!teamA && !teamB) return null;
  const sport = sportFrom(item, provider, cnc);
  const competition = competitionFrom(item, cnc);
  if (filter && !eligibleEvent(sport, item, cnc, competition)) return null;
  const eventKey = [sport, norm(teamA), norm(teamB)].sort().join('|');
  return {
    id, provider, type: 'tv', name: displayEventName(title, teamA, teamB),
    poster: item.poster || item.background, background: item.background || item.poster,
    description: cleanEventDescription(sport, competition, teamA, teamB),
    competition, releaseInfo: 'LIVE', sport, teamA, teamB, eventKey,
    badgeA: publicBadge(poster?.get('teamAImg') || item.team1?.logo),
    badgeB: publicBadge(poster?.get('teamBImg') || item.team2?.logo),
    sourceIds: [{ provider, id }], raw: item
  };
}
function similarity(a, b) {
  const x = norm(a), y = norm(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  const xt = new Set(x.split(' ')), yt = new Set(y.split(' '));
  const overlap = [...xt].filter(t => yt.has(t)).length;
  return overlap / Math.min(xt.size, yt.size);
}
function sameFixture(a, b) {
  if (a.sport !== b.sport || !a.teamA || !a.teamB || !b.teamA || !b.teamB) return false;
  const direct = similarity(a.teamA, b.teamA) + similarity(a.teamB, b.teamB);
  const reverse = similarity(a.teamA, b.teamB) + similarity(a.teamB, b.teamA);
  return Math.max(direct, reverse) >= 1.7;
}
function mergeBadges(event, source) {
  const direct = similarity(event.teamA, source.teamA) + similarity(event.teamB, source.teamB);
  const reverse = similarity(event.teamA, source.teamB) + similarity(event.teamB, source.teamA);
  const from = direct >= reverse ? ['A', 'B'] : ['B', 'A'];
  for (const [index, side] of ['A', 'B'].entries()) {
    const primary = `badge${side}`;
    const fallback = `fallbackBadge${side}`;
    const candidates = [event[primary], event[fallback], source[`badge${from[index]}`], source[`fallbackBadge${from[index]}`]];
    [event[primary], event[fallback]] = [...new Set(candidates.map(publicBadge).filter(Boolean))];
  }
}
function mergeEvents(events) {
  const out = [];
  for (const e of events) {
    const match = out.find(x => sameFixture(x, e));
    if (!match) out.push({ ...e, sourceIds: [...e.sourceIds] });
    else {
      for (const src of e.sourceIds) if (!match.sourceIds.some(x => x.provider === src.provider && x.id === src.id)) match.sourceIds.push(src);
      if (!match.poster && e.poster) match.poster = e.poster;
      if (!match.background && e.background) match.background = e.background;
      mergeBadges(match, e);
      if (!match.competition && e.competition) match.competition = e.competition;
      if (e.description && e.description.length > match.description.length) match.description = e.description;
    }
  }
  for (const event of out) event.description = cleanEventDescription(event.sport, event.competition, event.teamA, event.teamB);
  return out;
}
function b64url(text) { return btoa(unescape(encodeURIComponent(text))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, ''); }
function unb64url(text) { const s = text.replace(/-/g, '+').replace(/_/g, '/'); return decodeURIComponent(escape(atob(s + '='.repeat((4 - s.length % 4) % 4)))); }
function makeId(event) { return `sh_${b64url(JSON.stringify({ v: 1, sources: event.sourceIds, name: event.name, poster: event.poster, background: event.background, description: event.description, competition: event.competition, sport: event.sport, teamA: event.teamA, teamB: event.teamB, badgeA: event.badgeA, badgeB: event.badgeB, fallbackBadgeA: event.fallbackBadgeA, fallbackBadgeB: event.fallbackBadgeB, start: event.start, timeLabel: event.timeLabel, upcoming: event.upcoming }))}`; }
function emptySport(sport) {
  const name = SPORTS.find(([id]) => id === sport)?.[1] || catalogs.find(catalog => catalog.id === sport)?.league;
  return name ? {
    sport, name: 'No games today', competition: name, releaseInfo: 'No games today',
    description: `No live or upcoming games are listed for ${name} today.`, sourceIds: []
  } : null;
}
function isEmptySport(event) {
  return event?.name === 'No games today' && Boolean(emptySport(event.sport)) && !event.teamA && !event.teamB;
}
function parseId(id) { if (!String(id).startsWith('sh_')) return null; try { return JSON.parse(unb64url(id.slice(3))); } catch { return null; } }
function json(data, status = 200, extra = {}) { return new Response(JSON.stringify(data), { status, headers: { ...JSON_HEADERS, ...extra } }); }
async function fetchJson(url, timeout = 9000, cf) {
  if (!url) throw new Error('Provider URL not configured');
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeout);
  try { const res = await fetch(url, { signal: controller.signal, headers: { accept: 'application/json' }, cf }); if (!res.ok) throw new Error(`HTTP ${res.status}`); return await res.json(); }
  finally { clearTimeout(timer); }
}
function appendPath(base, path) { const u = new URL(base); const prefix = u.pathname.replace(/\/manifest\.json$/i, '').replace(/\/$/, ''); u.pathname = `${prefix}/${path.replace(/^\//, '')}`; u.search = ''; u.hash = ''; return u.toString(); }
async function providerCatalog(p, env, filter = true, aioCatalog) {
  const path = `catalog/${p.type}/${encodeURIComponent(aioCatalog || p.catalog)}.json`;
  const base = aioCatalog ? env.AIOSTREAMS_MANIFEST_URL : env[p.env];
  const data = await fetchJson(appendPath(base, path));
  if (!Array.isArray(data?.metas)) throw new Error('Invalid catalog response');
  const events = data.metas.map(x => eventFrom(x, p.key, filter)).filter(Boolean);
  if (aioCatalog) for (const event of events) event.sourceIds[0].viaAio = true;
  return { events, catalogEntries: data.metas.length };
}
function aioCatalogs(manifest, provider) {
  return arr(manifest?.catalogs).filter(entry => entry.type === provider.type &&
    !/highlights?|replays?/i.test(`${entry.id} ${entry.name || ''}`) &&
    (entry.id === provider.catalog || String(entry.id).endsWith(`.${provider.catalog}`) ||
      (provider.key === 'CNC' && /(?:^|\.)cnc_[a-z]+LiveEvents_tv$/i.test(entry.id))));
}
async function aioManifest(env) {
  return fetchJson(env.AIOSTREAMS_MANIFEST_URL, 6000, {
    cacheEverything: true, cacheTtlByStatus: { '200-299': 90, '400-599': 0 }
  });
}
async function catalogForProvider(provider, env, manifest, filter = true) {
  const catalogs = aioCatalogs(manifest, provider);
  if (catalogs.length) {
    const results = await Promise.allSettled(catalogs.map(catalog => providerCatalog(provider, env, filter, catalog.id)));
    const available = results.filter(result => result.status === 'fulfilled');
    if (available.length) return {
      transport: 'AIOStreams',
      events: available.flatMap(result => result.value.events),
      catalogEntries: available.reduce((sum, result) => sum + result.value.catalogEntries, 0)
    };
    if (!env[provider.env]) throw results[0].reason;
  }
  return env[provider.env] ? providerCatalog(provider, env, filter) : { events: [], catalogEntries: 0 };
}
async function probeProvider(provider, url, inspect) {
  if (!url) return { provider, status: 'unconfigured' };
  try {
    return { provider, status: 'ok', ...await inspect() };
  } catch (error) {
    const upstreamStatus = /^HTTP (\d{3})$/.exec(error?.message);
    return { provider, status: 'failed', ...(upstreamStatus && { upstreamStatus: Number(upstreamStatus[1]) }) };
  }
}
async function providerDiagnostics(env) {
  const direct = PROVIDERS.map(p => {
    const provider = PROVIDER_LABELS[p.key];
    return probeProvider(provider, env[p.env], async () => {
      const { events, catalogEntries } = await providerCatalog(p, env);
      return { catalogEntries, eligibleEvents: new Set(events.map(event => event.id)).size };
    });
  });
  const aio = probeProvider('AIOStreams', env.AIOSTREAMS_MANIFEST_URL, async () => {
    const data = await aioManifest(env);
    if (!Array.isArray(data?.resources)) throw new Error('Invalid manifest response');
    const active = AIO_PROVIDERS.filter(p => aioCatalogs(data, p).length);
    const addonCatalogs = await Promise.all(active.map(p => probeProvider(PROVIDER_LABELS[p.key], env.AIOSTREAMS_MANIFEST_URL, async () => {
      const { catalogEntries, events, transport } = await catalogForProvider(p, env, data, false);
      return { catalogEntries, liveEvents: new Set(events.map(event => event.id)).size, transport: transport || 'direct fallback' };
    })));
    return {
      advertisedCatalogs: arr(data.catalogs).length,
      advertisesStreams: data.resources.some(resource => resource === 'stream' || resource?.name === 'stream'),
      ...(addonCatalogs.length && { addonCatalogs })
    };
  });
  const [providers, aiostreams] = await Promise.all([Promise.all(direct), aio]);
  return { providers, aiostreams };
}
function fixtureEvent(fixture) {
  const sport = sportFrom({ category: fixture.category, competition: fixture.competition, title: fixture.title });
  return { ...fixture, sport, name: displayEventName(fixture.title || fixture.teamA, fixture.teamA, fixture.teamB) };
}
function matchesCatalog(event, catalog) {
  if (catalog.sport && event.sport !== catalog.sport) return false;
  if (!catalog.league) return true;
  const league = String(event.competition || '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim()
    .replace(/ (?:PRESEASON|REGULAR SEASON|PLAYOFFS|FINALS|CUP|POSTSEASON)$/, '');
  const aliases = {
    NBA: ['NBA', 'NATIONAL BASKETBALL ASSOCIATION'],
    WNBA: ['WNBA', 'WOMEN S NATIONAL BASKETBALL ASSOCIATION'],
    NHL: ['NHL', 'NATIONAL HOCKEY LEAGUE'],
    PWHL: ['PWHL', 'PROFESSIONAL WOMEN S HOCKEY LEAGUE'],
    NFL: ['NFL', 'NATIONAL FOOTBALL LEAGUE'],
    MLB: ['MLB', 'MAJOR LEAGUE BASEBALL']
  };
  return aliases[catalog.league].includes(league);
}
function upcomingEvents({ fixtures, isUpcoming }, catalog) {
  const priority = ['pwhl', 'espn', 'sportsdb', 'apisports'];
  const candidates = fixtures.filter(isUpcoming).map(fixtureEvent)
    .filter(event => matchesCatalog(event, catalog) && eligibleEvent(event.sport, event, null, event.competition))
    .sort((a, b) => priority.indexOf(a.provider) - priority.indexOf(b.provider));
  const events = [];
  for (const event of candidates) {
    const match = events.find(previous => Math.abs(previous.start - event.start) < 20 * 60000 && sameFixture(previous, event));
    if (match) mergeBadges(match, event);
    else events.push(event);
  }
  return events.sort((a, b) => a.start - b.start)
    .map(event => ({
      ...event, upcoming: true, sourceIds: [],
      description: [`Starts: ${event.timeLabel}`, event.competition, event.name].filter(Boolean).join('\n')
    }));
}
function findFixture(event, fixtures) {
  const matches = fixtures.filter(fixture => sameFixture(
    event.provider === 'CNC' && event.sport === 'other' ? { ...event, sport: fixture.sport } : event,
    fixture
  ));
  if (matches.length === 1) return matches[0];
  const scoreboard = matches.find(fixture => fixture.provider === 'pwhl')
    || matches.find(fixture => fixture.provider === 'espn')
    || matches.find(fixture => fixture.provider === 'apisports');
  if (scoreboard && matches.every(fixture => Math.abs(fixture.start - scoreboard.start) < 20 * 60000
      && sameFixture(fixture, scoreboard))) return scoreboard;
  if (!event.competition) return undefined;
  const exactLeague = matches.filter(fixture => norm(fixture.competition) === norm(event.competition));
  return exactLeague.length === 1 ? exactLeague[0] : undefined;
}
async function allEvents(env, fixtureData = []) {
  const manifest = env.AIOSTREAMS_MANIFEST_URL ? await aioManifest(env).catch(() => null) : null;
  const configured = AIO_PROVIDERS.filter(p => env[p.env] || aioCatalogs(manifest, p).length);
  const [results, fixtures] = await Promise.all([
    Promise.allSettled(configured.map(p => catalogForProvider(p, env, manifest, false))),
    fixtureData
  ]);
  const events = results.flatMap(r => r.status === 'fulfilled' ? r.value.events : []);
  return mergeEvents(events.flatMap(event => {
    const fixture = findFixture(event, fixtures);
    if (!fixture && event.provider === 'CNC' && event.sport === 'other' && !decodeCnc(event.id)) return [];
    const updated = fixture ? { ...event, ...fixture } : event;
    if (fixture) mergeBadges(updated, event);
    const classification = fixture ? { category: fixture.category, competition: fixture.competition } : event.raw;
    const cnc = !fixture && event.provider === 'CNC' ? decodeCnc(event.id) : null;
    return eligibleEvent(updated.sport, classification, cnc, updated.competition) ? [updated] : [];
  }));
}
function metaOf(e, origin, extension = 'svg') {
  const sportName = SPORTS.find(x => x[0] === e.sport)?.[1] || 'Other Sports';
  const id = makeId(e);
  const empty = isEmptySport(e);
  const hasArtwork = origin && (empty || isPosterMatchup(e));
  const poster = hasArtwork ? `${origin}/artwork/${id}.${extension}` : e.poster || e.background;
  const description = e.description || cleanEventDescription(e.sport, e.competition, e.teamA, e.teamB);
  return {
    id, type: 'tv', name: e.name || displayEventName('', e.teamA, e.teamB),
    poster, background: hasArtwork ? `${origin}/artwork/wide/${id}.${extension}` : e.background || poster,
    description: !e.upcoming && e.timeLabel ? `${description}\nScheduled start: ${e.timeLabel}` : description,
    releaseInfo: empty ? 'No games today' : e.upcoming ? e.timeLabel : 'LIVE NOW', genres: [sportName],
    cast: [e.teamA, e.teamB].filter(Boolean),
    behaviorHints: { defaultVideoId: id }
  };
}
function isPosterMatchup(event) {
  return [event?.teamA, event?.teamB].every(name => typeof name === 'string' && name.trim() && name.length <= 160);
}
function streamUrl(base, type, id) { return appendPath(base, `stream/${type}/${encodeURIComponent(id)}.json`); }

function isEnglishStream(stream) {
  return classifyLanguage(stream).language === 'english';
}
function isUsableStream(stream, preference) {
  return !!stream && !isPromo(stream) && !stream.externalUrl && !!(stream.url || stream.infoHash || stream.ytId)
    && streamLanguageAllowed(classifyLanguage(stream), preference);
}
async function sourceStreams(src, env, timeout) {
  const provider = AIO_PROVIDERS.find(p => p.key === src.provider);
  if (!provider) return [];
  const base = src.viaAio ? env.AIOSTREAMS_MANIFEST_URL : env[provider.env];
  if (!base) return [];
  const data = await fetchJson(streamUrl(base, provider.type, src.id), timeout);
  return arr(data.streams).filter(stream => isUsableStream(stream, env.SPORTHUB_STREAM_LANGUAGES));
}
async function visibleLiveEvents(events, env) {
  const other = events.filter(event => event.sport === 'other');
  // Reserve room for fixture and catalog fetches on the Workers free plan.
  const maxChecks = 12;
  let remaining = maxChecks;
  const checked = await Promise.all(other.map(async event => {
    const sources = event.sourceIds.slice(0, Math.min(remaining, 2));
    remaining -= sources.length;
    const streams = await Promise.allSettled(sources.map(source => sourceStreams(source, env, 3000)));
    return streams.some(result => result.status === 'fulfilled' && result.value.length) ? event : null;
  }));
  const visible = new Set(checked.filter(Boolean));
  return events.filter(event => event.sport !== 'other' || visible.has(event));
}
async function fetchStreams(sourceIds, env) {
  const tasks = sourceIds.map(async src => {
    const streams = await sourceStreams(src, env, 12000);
    return streams.map(stream => ({ stream, provider: PROVIDER_LABELS[src.provider], ...classifyLanguage(stream) }));
  });
  const settled = await Promise.allSettled(tasks);
  const candidates = settled.flatMap(r => r.status === 'fulfilled' ? r.value : []);
  return rankStreams(candidates);
}
function manifest(env = {}) {
  return {
    id: 'community.sportshub.live', version: '0.2.9', name: 'SportsHub',
    description: 'Live sports and today’s upcoming games, with configurable stream languages.',
    resources: ['catalog', 'meta', 'stream'], types: ['tv'], idPrefixes: ['sh_'],
    catalogs: enabledCatalogs(env.SPORTHUB_CATALOGS).map(({ id, name, extra }) => ({ type: 'tv', id, name, extra })),
    behaviorHints: { configurable: false, configurationRequired: false }
  };
}
export default {
  async fetch(request, env, { artworkExtension, metadataCache, waitUntil } = {}) {
    const url = new URL(request.url);
    const cacheOptions = { cache: metadataCache, origin: url.origin, waitUntil };
    if (request.method === 'OPTIONS') return new Response(null, { headers: JSON_HEADERS });
    if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);
    if (url.pathname === '/manifest.json') return json(manifest(env), 200, { 'cache-control': 'public, max-age=300' });
    if (url.pathname === '/diagnostics/providers.json') {
      if (url.searchParams.has('fixtures')) {
        const data = await loadFixtures(env, fetchJson, cacheOptions);
        return json({ requests: data.requests, upcoming: data.fixtures.filter(data.isUpcoming).length,
          cached: data.cached, refreshedAt: new Date(data.refreshedAt).toISOString(), usedStale: data.usedStale
        }, 200, { 'cache-control': 'no-store' });
      }
      return json(await providerDiagnostics(env), 200, { 'cache-control': 'no-store' });
    }
    const artworkMatch = url.pathname.match(/^\/artwork\/(wide\/)?(sh_[\w-]+)\.svg$/);
    if (artworkMatch) {
      const event = parseId(artworkMatch[2]);
      if (isEmptySport(event)) {
        return matchupPoster({ empty: true, competition: emptySport(event.sport).competition }, Boolean(artworkMatch[1]));
      }
      if (isPosterMatchup(event)) {
        return matchupPoster({ ...event, competition: String(event.competition || '') }, Boolean(artworkMatch[1]));
      }
      return json({ error: 'Invalid matchup' }, 400);
    }
    const catalogMatch = url.pathname.match(/^\/catalog\/tv\/([^/]+)\.json$/);
    if (catalogMatch) {
      const catalogId = decodeURIComponent(catalogMatch[1]);
      const catalog = enabledCatalogs(env.SPORTHUB_CATALOGS).find(candidate => candidate.id === catalogId);
      if (!catalog) return json({ error: 'Catalog not found' }, 404);
      const sport = catalog.sport;
      const upcoming = catalogId === 'upcoming_today';
      const checkLive = catalogId === 'live_now' || sport === 'other';
      const fixtureData = loadFixtures(env, fetchJson, { ...cacheOptions, compact: checkLive });
      const live = upcoming ? [] : await allEvents(env, fixtureData.then(({ fixtures }) => fixtures
        .filter(fixture => fixture.start <= Date.now() + 30 * 60000).map(fixtureEvent)));
      const matching = live.filter(event => matchesCatalog(event, catalog));
      const current = checkLive ? await visibleLiveEvents(matching, env) : matching;
      const scheduled = upcoming || (sport && sport !== 'other') ? upcomingEvents(await fixtureData, catalog) : [];
      const events = [...current, ...scheduled.filter(event => !current.some(match =>
        sameFixture(match, event) && (!match.start || Math.abs(match.start - event.start) < 20 * 60000)))];
      const empty = !events.length && sport && emptySport(catalog.league ? catalog.id : sport);
      if (empty) events.push(empty);
      const metas = events.map(event => metaOf(event, url.origin, artworkExtension));
      return json({ metas, cacheMaxAge: 15, staleRevalidate: 10, staleError: 30 }, 200, { 'cache-control': 'public, max-age=15' });
    }
    const metaMatch = url.pathname.match(/^\/meta\/tv\/(sh_[^/]+)\.json$/);
    if (metaMatch) {
      const payload = parseId(decodeURIComponent(metaMatch[1])); if (!payload) return json({ meta: null }, 400);
      const fallback = { ...payload, sourceIds: arr(payload.sources), name: payload.name || 'Sports event', competition: payload.competition || '', sport: payload.sport || 'other' };
      return json({ meta: metaOf(fallback, url.origin, artworkExtension), cacheMaxAge: 5 });
    }
    const streamMatch = url.pathname.match(/^\/stream\/tv\/(sh_[^/]+)\.json$/);
    if (streamMatch) {
      const payload = parseId(decodeURIComponent(streamMatch[1])); if (!payload) return json({ streams: [] }, 400);
      let sources = arr(payload.sources);
      if (payload.upcoming && payload.start <= Date.now()) {
        const matches = (await allEvents(env, [payload])).filter(event => sameFixture(event, payload));
        if (matches.length === 1) sources = matches[0].sourceIds;
      }
      const streams = await fetchStreams(sources, env);
      return json({ streams, cacheMaxAge: 2, staleRevalidate: 0, staleError: 0 }, 200, { 'cache-control': 'no-store' });
    }
    return json({ error: 'Not found' }, 404);
  }
};
export { SPORTS, SPORT_ICONS, PROVIDERS, eventFrom, sameFixture, mergeEvents, makeId, parseId, manifest, metaOf, sportFrom, appendPath, isUsableStream, isEnglishStream };
