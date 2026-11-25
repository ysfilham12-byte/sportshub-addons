import test from 'node:test';
import assert from 'node:assert/strict';
import worker,{eventFrom,manifest,makeId,parseId,isUsableStream,appendPath} from '../src/index.js';
import { rankStreams } from '../src/stream-quality.js';

test('league catalogs are opt-in and keep NBA, WNBA, and the sport row distinct', async t => {
  t.mock.method(globalThis, 'fetch', async input => new URL(input).hostname === 'provider.test'
    ? Response.json({ metas: [
      live('Boston vs New York', 'basketball', 'League: NBA Playoffs'),
      live('Seattle vs Phoenix', 'basketball', 'League: WNBA'),
      live('Duke vs Kansas', 'basketball', 'League: NCAA Basketball')
    ] })
    : Response.json({ events: [] }));
  const env = { NUVIO_MANIFEST_URL: 'https://provider.test/manifest.json',
    SPORTHUB_CATALOGS: 'sport_basketball,league_nba,league_wnba,league_pwhl' };
  const get = async id => (await (await worker.fetch(new Request(`https://x/catalog/tv/${id}.json`), env)).json()).metas.map(e => e.name);
  assert.equal(manifest().catalogs.some(catalog => catalog.id.startsWith('league_')), false);
  assert.deepEqual(await get('league_nba'), ['Boston vs New York']);
  assert.deepEqual(await get('league_wnba'), ['Seattle vs Phoenix']);
  assert.deepEqual(await get('sport_basketball'), ['Boston vs New York', 'Seattle vs Phoenix', 'Duke vs Kansas']);
  assert.deepEqual(await get('league_pwhl'), ['No games today']);
});

test('stream language preferences support strict, selected, and unrestricted lists', async t => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ streams: [
    { name: '1080p English', url: 'https://video.test/en.m3u8' },
    { name: '1080p', audioLanguages: [{ code: 'ES-MX' }], url: 'https://video.test/es.m3u8' },
    { description: '720p [FR]', url: 'https://video.test/fr.m3u8' },
    { name: '720p unlabeled', url: 'https://video.test/unknown.m3u8' }
  ] }));
  const id = makeId({ sourceIds: [{ provider: 'NUVIO', id: 'abc' }] });
  const get = async preference => {
    const env = { NUVIO_MANIFEST_URL: 'https://provider.test/manifest.json', SPORTHUB_STREAM_LANGUAGES: preference };
    const { streams } = await (await worker.fetch(new Request(`https://x/stream/tv/${id}.json`), env)).json();
    return streams.map(stream => stream.name.split(' · ').at(-1));
  };
  assert.deepEqual(await get(''), ['English', 'Language unverified']);
  assert.deepEqual(await get('english'), ['English']);
  assert.deepEqual(await get('es,fr,unknown'), ['Spanish', 'French', 'Language unverified']);
  assert.deepEqual(await get('any'), ['English', 'Spanish', 'French', 'Language unverified']);
});

test('catalog preferences expose only the selected rows and keep standard defaults', async () => {
  const env = { SPORTHUB_CATALOGS: ' sport_rugby,upcoming_today,unknown,sport_rugby ' };
  const response = await worker.fetch(new Request('https://x/manifest.json'), env);
  assert.deepEqual((await response.json()).catalogs.map(catalog => catalog.id), ['upcoming_today', 'sport_rugby']);
  assert.equal((await worker.fetch(new Request('https://x/catalog/tv/live_now.json'), env)).status, 404);
  assert.deepEqual(manifest({ SPORTHUB_CATALOGS: ' ' }).catalogs, manifest().catalogs);
});

test('Rugby has its own row and Other Sports only lists live events with eligible streams', async t => {
  t.mock.method(globalThis, 'fetch', async input => {
    const url = new URL(input);
    if (url.hostname !== 'provider.test') return Response.json({ events: [] });
    if (url.pathname.startsWith('/catalog/')) return Response.json({ metas: [
      live('Ireland vs France', 'rugby'),
      live('A vs B', 'volleyball'),
      live('C vs D', 'volleyball'),
      live('E vs F Highlights', 'volleyball')
    ] });
    return Response.json({ streams: url.pathname.includes('nuvio_A%20vs%20B')
      ? [{ name: 'English', url: 'https://video.test/live.m3u8' }] : [] });
  });
  const env = { NUVIO_MANIFEST_URL: 'https://provider.test/manifest.json' };
  const get = id => worker.fetch(new Request(`https://x/catalog/tv/${id}.json`), env);
  assert.deepEqual((await (await get('sport_rugby')).json()).metas.map(e => e.name), ['Ireland vs France']);
  assert.deepEqual((await (await get('sport_other')).json()).metas.map(e => e.name), ['A vs B']);
  assert.deepEqual((await (await get('live_now')).json()).metas.map(e => e.name), ['Ireland vs France', 'A vs B']);
  assert.equal((await get('playfy_highlights')).status, 404);
});

test('ranks resolution across addons before language and bitrate, with the addon in stream details', async t => {
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, 'https://stream.nuviosports.xyz/master.m3u8');
    assert.equal(options.redirect, 'manual');
    return new Response('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=6000000,AVERAGE-BANDWIDTH=5200000,RESOLUTION=1920x1080\n1080.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=1280x720\n720.m3u8');
  });
  const candidate = (name, language, url) => ({ stream: { name, url }, language, provider: 'HighFly' });
  const streams = await rankStreams([
    candidate('4K 10 Mbps', 'unknown', 'https://unknown.test/live.m3u8'),
    candidate('1080p 4 Mbps', 'english', 'https://unknown.test/live.m3u8'),
    { ...candidate('720p 8 Mbps', 'english', 'https://unknown.test/live.m3u8'), provider: 'Nuvio' },
    { ...candidate('1080p 9 Mbps', 'unknown', 'https://unknown.test/live.m3u8'), provider: 'Nuvio' },
    candidate('Live', 'english', 'https://stream.nuviosports.xyz/master.m3u8')
  ]);
  assert.deepEqual(streams.map(stream => stream.name), [
    '2160p · 10 Mbps reported · Language unverified',
    'Up to 1080p · 5.2 Mbps avg · English',
    '1080p · 4 Mbps reported · English',
    '1080p · 9 Mbps reported · Language unverified',
    '720p · 8 Mbps reported · English'
  ]);
  assert.equal(streams[1].description, 'Live\nAddon: HighFly');
});

test('root-level provider manifests resolve to a single-slash resource path', () => {
  assert.equal(appendPath('https://provider.test/manifest.json', 'catalog/tv/live.json'),
    'https://provider.test/catalog/tv/live.json');
});

test('CNCVerse accepts opaque live event IDs and uses poster matchup fields', () => {
  const item = { id: 'cnc:opaque', name: '🔴 Brentford vs Everton',
    poster: 'https://provider.test/card?isLive=true&isEnded=false&teamA=Brentford&teamB=Everton' };
  const event = eventFrom(item, 'CNC', false);
  assert.deepEqual([event.teamA, event.teamB], ['Brentford', 'Everton']);
  assert.equal(event.sourceIds[0].id, item.id);
  assert.equal(eventFrom({ ...item, poster: item.poster.replace('isEnded=false', 'isEnded=true') }, 'CNC', false), null);
});

test('AIOStreams catalogs preserve provider routes through stream resolution', async t => {
  const catalogs = [
    { type: 'sport', id: 'hash.sports_live' },
    { type: 'tv', id: 'hash.pp-live-now' }
  ];
  t.mock.method(globalThis, 'fetch', async input => {
    const url = new URL(input);
    if (url.hostname !== 'aio.test') return Response.json({ events: [] });
    if (url.pathname.endsWith('/manifest.json')) return Response.json({ catalogs, resources: ['stream'] });
    if (url.pathname.endsWith('/hash.sports_live.json')) return Response.json({ metas: [
      { ...live('Bulls vs Celtics', 'basketball', 'League: NBA'), id: 'streamed:80' }
    ] });
    if (url.pathname.endsWith('/hash.pp-live-now.json')) return Response.json({ metas: [
      { ...live('Bulls vs Celtics', 'basketball', 'League: NBA'), id: 'pp-live:80' }
    ] });
    assert.match(url.pathname, /\/private\/stream\/(?:sport\/streamed|tv\/pp-live)%3A80\.json$/);
    return Response.json({ streams: [{ name: 'English', url: 'https://video.test/live.m3u8' }] });
  });
  const env = { AIOSTREAMS_MANIFEST_URL: 'https://aio.test/private/manifest.json' };
  const { metas } = await (await worker.fetch(new Request('https://x/catalog/tv/live_now.json'), env)).json();
  assert.equal(metas.length, 1);
  assert.deepEqual(parseId(metas[0].id).sources, [
    { provider: 'HIGHFLY', id: 'streamed:80', viaAio: true },
    { provider: 'PP', id: 'pp-live:80', viaAio: true }
  ]);
  const { streams } = await (await worker.fetch(new Request(`https://x/stream/tv/${metas[0].id}.json`), env)).json();
  assert.deepEqual(streams.map(stream => stream.description.split('\n').at(-1)), ['Addon: HighFly', 'Addon: PenguPlay']);
});

test('Upcoming Today falls back to scoreboard fixtures when the primary feed is throttled', async t => {
  t.mock.method(Date, 'now', () => Date.parse('2026-11-23T20:00:00Z'));
  t.mock.method(globalThis, 'fetch', async input => {
    const url = new URL(input);
    if (url.hostname === 'www.thesportsdb.com') return new Response(null, { status: 429 });
    const event = {
      id: '100', date: '2026-11-24T00:00:00Z', status: { type: { state: 'pre' } },
      competitions: [{ competitors: [
        { homeAway: 'home', team: { displayName: 'Boston Celtics' } },
        { homeAway: 'away', team: { displayName: 'New York Knicks' } }
      ] }]
    };
    return Response.json({ events: url.pathname.includes('/nba/') ? [event] : [] });
  });
  const { metas } = await (await worker.fetch(new Request('https://x/catalog/tv/upcoming_today.json'), {})).json();
  assert.deepEqual(metas.map(event => event.name), ['Boston Celtics vs New York Knicks']);
});

test('Upcoming Today includes tomorrow UTC games that start tonight in Toronto', async t => {
  const now = Date.parse('2026-11-23T23:00:00Z');
  t.mock.method(Date, 'now', () => now);
  const fixture = {
    idEvent: '101', strTimestamp: '2026-11-24T00:30:00', strLeague: 'NBA',
    strSport: 'Basketball', strHomeTeam: 'Boston Celtics', strAwayTeam: 'New York Knicks',
    strHomeTeamBadge: 'https://r2.thesportsdb.com/images/home.png',
    strAwayTeamBadge: 'https://r2.thesportsdb.com/images/away.png'
  };
  t.mock.method(globalThis, 'fetch', async input => {
    const url = new URL(input);
    if (url.hostname === 'r2.thesportsdb.com') {
      return new Response(url.pathname.endsWith('home.png') ? 'home' : 'away', {
        headers: { 'content-type': 'image/png' }
      });
    }
    assert.equal(url.hostname, 'www.thesportsdb.com');
    const events = url.searchParams.get('d') === '2026-11-24' ? [
      fixture,
      { ...fixture, idEvent: '102', strTimestamp: '2026-11-24T05:30:00' },
      { ...fixture, idEvent: '103', strStatus: 'Postponed' }
    ] : [];
    return Response.json({ events });
  });
  const { metas } = await (await worker.fetch(new Request('https://x/catalog/tv/upcoming_today.json'), {})).json();
  assert.equal(metas.length, 1);
  const [event] = metas;
  assert.equal(event.name, 'Boston Celtics vs New York Knicks');
  assert.match(event.releaseInfo, /7:30/);
  const catalog = async id => (await (await worker.fetch(new Request(`https://x/catalog/tv/${id}.json`), {})).json()).metas;
  assert.deepEqual((await catalog('sport_basketball')).map(game => game.id), [event.id]);
  const [empty] = await catalog('sport_hockey');
  assert.equal(empty.name, 'No games today');
  assert.equal(empty.releaseInfo, 'No games today');
  assert.match(await (await worker.fetch(new Request(empty.poster), {})).text(), /No games today/);
  const { meta: emptyMeta } = await (await worker.fetch(new Request(`https://x/meta/tv/${empty.id}.json`), {})).json();
  assert.equal(emptyMeta.id, empty.id);
  const { streams: emptyStreams } = await (await worker.fetch(new Request(`https://x/stream/tv/${empty.id}.json`), {})).json();
  assert.deepEqual(emptyStreams, []);
  assert.deepEqual(await catalog('live_now'), []);
  const response = await worker.fetch(new Request(event.poster), {});
  assert.match(response.headers.get('content-type'), /image\/svg/);
  const svg = await response.text();
  assert.match(svg, /Boston Celtics/);
  assert.match(svg, /New York Knicks/);
  assert.match(svg, /base64,aG9tZQ==/);
  assert.match(svg, /base64,YXdheQ==/);
  const wide = await (await worker.fetch(new Request(event.background), {})).text();
  assert.match(wide, /viewBox="0 0 960 540"/);
  assert.equal((wide.match(/<image /g) || []).length, 2);
  const { meta } = await (await worker.fetch(new Request(`https://x/meta/tv/${event.id}.json`), {})).json();
  assert.equal(meta.poster, event.poster);
  const { streams } = await (await worker.fetch(new Request(`https://x/stream/tv/${event.id}.json`), {})).json();
  assert.deepEqual(streams, []);
});

test('live catalog applies independent fixture metadata while keeping upstream stream IDs', async t => {
  t.mock.method(Date, 'now', () => Date.parse('2026-11-23T23:00:00Z'));
  t.mock.method(globalThis, 'fetch', async input => {
    const url = new URL(input);
    if (url.hostname === 'www.thesportsdb.com') return Response.json({ events: [{
      idEvent: '200', strTimestamp: '2026-11-23T22:30:00', strLeague: 'English Premier League',
      strSport: 'Soccer', strHomeTeam: 'Arsenal FC', strAwayTeam: 'Chelsea FC'
    }] });
    return Response.json({ metas: [live('Arsenal vs Chelsea', 'football')] });
  });
  const env = { NUVIO_MANIFEST_URL: 'https://provider.test/manifest.json' };
  const { metas } = await (await worker.fetch(new Request('https://x/catalog/tv/sport_soccer.json'), env)).json();
  assert.equal(metas.length, 1);
  assert.equal(metas[0].name, 'Arsenal FC vs Chelsea FC');
  assert.match(metas[0].description, /English Premier League/);
  assert.deepEqual(parseId(metas[0].id).sources, [{ provider: 'NUVIO', id: 'nuvio_Arsenal vs Chelsea' }]);
});

test('provider diagnostics report coverage and failures without exposing configured URLs', async t => {
  t.mock.method(globalThis, 'fetch', async input => {
    const host = new URL(input).hostname;
    if (host === 'n.test') return Response.json({ metas: [{ id: 'channel_ch_example' }] });
    if (host === 'h.test') return new Response(null, { status: 404 });
    return Response.json({ resources: [{ name: 'stream' }], catalogs: [{ id: 'sports' }] });
  });
  const response = await worker.fetch(new Request('https://x/diagnostics/providers.json'), {
    NUVIO_MANIFEST_URL: 'https://n.test/private/manifest.json',
    HIGHFLY_MANIFEST_URL: 'https://h.test/private/manifest.json',
    AIOSTREAMS_MANIFEST_URL: 'https://aio.test/private/manifest.json'
  });
  assert.deepEqual(await response.json(), {
    providers: [
      { provider: 'Nuvio', status: 'ok', catalogEntries: 1, eligibleEvents: 0 },
      { provider: 'HighFly', status: 'failed', upstreamStatus: 404 },
      { provider: 'CNCVerse', status: 'unconfigured' }
    ],
    aiostreams: { provider: 'AIOStreams', status: 'ok', advertisedCatalogs: 1, advertisesStreams: true }
  });
});
const live=(name,category,description='Status: LIVE NOW')=>({id:`nuvio_${name}`,name:`🔴 LIVE: ${name}`,genres:[category],poster:`https://x/match?cat=${category}&st=live`,releaseInfo:'LIVE',description,cast:name.split(' vs ')});
test('exact final categories in user order',()=>assert.deepEqual(manifest().catalogs.map(c=>c.id),['live_now','upcoming_today','sport_soccer','sport_football','sport_basketball','sport_hockey','sport_baseball','sport_mma','sport_tennis','sport_motorsport','sport_rugby','sport_other']));
test('major soccer accepted and obscure soccer rejected',()=>{assert.equal(eventFrom(live('Arsenal vs Chelsea','football','League: Premier League\nStatus: LIVE NOW'),'NUVIO').sport,'soccer');assert.equal(eventFrom(live('Village FC vs Town FC','football'),'NUVIO'),null)});
test('soccer requires a recognized competition, including in Live Now', () => {
  for (const competition of ['Egyptian Premier League', 'Bundesliga 2', 'AFC Champions League', 'U17 World Cup', 'World Cup Qualifiers']) {
    assert.equal(eventFrom(live('Team A vs Team B', 'football', `League: ${competition}`), 'NUVIO'), null, competition);
  }
  assert.equal(eventFrom(live('Team A vs Team B', 'football', 'Watch Premier League coverage'), 'NUVIO'), null);
  assert.equal(eventFrom(live('Inter vs Arsenal', 'football', 'League: UEFA Champions League'), 'NUVIO')?.sport, 'soccer');
});
test('cricket excluded from Other Sports',()=>assert.equal(eventFrom(live('India vs Australia','cricket','League: ICC Cricket World Cup'),'NUVIO'),null));
test('WNBA and PWHL grouped by sport',()=>{assert.equal(eventFrom(live('Liberty vs Aces','basketball','League: WNBA'),'NUVIO').sport,'basketball');assert.equal(eventFrom(live('Toronto vs Montreal','hockey','League: PWHL'),'NUVIO').sport,'hockey')});
test('Other Sports accepts volleyball',()=>assert.equal(eventFrom(live('Team A vs Team B','volleyball'),'NUVIO').sport,'other'));
test('tennis and motorsport tournament restrictions',()=>{assert.equal(eventFrom(live('A vs B','tennis','League: Wimbledon'),'NUVIO').sport,'tennis');assert.equal(eventFrom(live('A vs B','tennis'),'NUVIO'),null);assert.equal(eventFrom(live('F1 Grand Prix','motorsport'),'NUVIO').sport,'motorsport');assert.equal(eventFrom(live('Formula 2 Grand Prix','motorsport'),'NUVIO'),null)});
test('English and unknown stream candidates allowed but explicit non-English blocked',()=>{assert.equal(isUsableStream({name:'HD feed',url:'https://x/live.m3u8'}),true);assert.equal(isUsableStream({name:'Spanish',url:'https://x/live.m3u8'}),false);assert.equal(isUsableStream({name:'English',url:'https://x/live.m3u8'}),true)});
test('verified English streams appear before clearly labeled unknown streams',async()=>{const original=globalThis.fetch;try{globalThis.fetch=async()=>Response.json({streams:[{name:'HD',url:'https://x/1.m3u8'},{name:'English HD',url:'https://x/2.m3u8'},{name:'Spanish HD',url:'https://x/3.m3u8'}]});const id=makeId({sourceIds:[{provider:'NUVIO',id:'abc'}]});const env={NUVIO_MANIFEST_URL:'https://x/token/manifest.json'};let body=await(await worker.fetch(new Request(`https://x/stream/tv/${id}.json`),env)).json();assert.deepEqual(body.streams.map(stream=>stream.name),["Quality unknown · Bitrate unknown · English","Quality unknown · Bitrate unknown · Language unverified"]);globalThis.fetch=async()=>Response.json({streams:[{name:'HD',url:'https://x/1.m3u8'},{name:'Spanish HD',url:'https://x/3.m3u8'}]});body=await(await worker.fetch(new Request(`https://x/stream/tv/${id}.json`),env)).json();assert.equal(body.streams.length,1);assert.match(body.streams[0].name,/Language unverified/)}finally{globalThis.fetch=original}});
test('event IDs roundtrip',()=>assert.equal(parseId(makeId({sourceIds:[{provider:'NUVIO',id:'abc'}]})).sources[0].id,'abc'));
test('catalog combines providers and returns only eligible events',async()=>{const original=globalThis.fetch;const calls=[];try{globalThis.fetch=async input=>{const path=new URL(input).pathname;if(path.endsWith('/eventsday.php')||path.endsWith('/scoreboard')||path==='/en/schedule')return Response.json({events:null});calls.push(path);if(path.includes('nuvio_sports_live'))return Response.json({metas:[live('Arsenal vs Chelsea','football','League: Premier League\nStatus: LIVE NOW'),live('Village FC vs Town FC','football')]});return Response.json({metas:[]})};const env={NUVIO_MANIFEST_URL:'https://n.test/token/manifest.json',HIGHFLY_MANIFEST_URL:'https://h.test/token/manifest.json',CNC_MANIFEST_URL:'https://c.test/token/manifest.json'};const body=await(await worker.fetch(new Request('https://x/catalog/tv/sport_soccer.json'),env)).json();assert.equal(body.metas.length,1);assert.equal(body.metas[0].name,'Arsenal vs Chelsea');assert.equal(calls.length,3)}finally{globalThis.fetch=original}});
test('provider stream preserves playback hints',async()=>{const original=globalThis.fetch;try{globalThis.fetch=async()=>Response.json({streams:[{name:'English HD',url:'https://cdn.test/live.m3u8',behaviorHints:{notWebReady:true},proxyHeaders:{request:{Referer:'https://provider.test'}}}]});const id=makeId({sourceIds:[{provider:'NUVIO',id:'abc'}]});const body=await(await worker.fetch(new Request(`https://x/stream/tv/${id}.json`),{NUVIO_MANIFEST_URL:'https://n.test/token/manifest.json'})).json();assert.equal(body.streams[0].behaviorHints.notWebReady,true);assert.equal(body.streams[0].proxyHeaders.request.Referer,'https://provider.test')}finally{globalThis.fetch=original}});

test('American football and basketball only major North American competitions',()=>{
 for(const [sport,cat,league] of [['football','american football','NFL'],['football','american football','NCAA Football'],['basketball','basketball','NBA'],['basketball','basketball','WNBA'],['basketball','basketball','NCAA Basketball']]) { const e=eventFrom(live('Team A vs Team B',cat,`League: ${league}`),'NUVIO'); assert.equal(e?.sport,sport,league); }
 for(const [cat,league] of [['american football','CFL'],['american football','UFL'],['american football','European League of Football'],['basketball','EuroLeague'],['basketball','FIBA World Cup'],['basketball','NBL Australia'],['basketball','NBA G League'],['basketball','Unknown League']]) assert.equal(eventFrom(live('Team A vs Team B',cat,`League: ${league}`),'NUVIO'),null,league);
});
test('sport catalogs include broad hockey and baseball',()=>{assert.equal(eventFrom(live('Toronto vs Montreal','hockey','League: PWHL'),'NUVIO').sport,'hockey');assert.equal(eventFrom(live('Yankees vs Mets','baseball','League: MLB'),'NUVIO').sport,'baseball')});
