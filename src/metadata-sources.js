const pwhlPage = 'https://www.thepwhl.com/en/schedule';
const apiSports = [
  ['https://v3.football.api-sports.io/fixtures', 'Soccer'],
  ['https://v1.basketball.api-sports.io/games', 'Basketball'],
  ['https://v1.hockey.api-sports.io/games', 'Ice Hockey'],
  ['https://v1.rugby.api-sports.io/games', 'Rugby']
];
const soccerLeagues = new Set([1, 2, 3, 4, 9, 13, 39, 45, 61, 66, 78, 81, 135, 137, 140, 143]);

function pwhlLogo(team, key) {
  const value = team?.[key]?.[0]?.secure_url?.replaceAll('\\/', '/');
  const prefix = 'https://res.cloudinary.com/pwhl-low/image/upload/';
  if (!value?.startsWith(prefix)) return undefined;
  return `${prefix}w_240,h_240,c_limit,f_png/${value.slice(prefix.length)}`;
}

export async function fetchPwhl(fetchImpl = fetch) {
  const response = await fetchImpl(pwhlPage, {
    redirect: 'manual', signal: AbortSignal.timeout(6500),
    cf: { cacheEverything: true, cacheTtlByStatus: { '200-299': 900, '400-599': 0 } }
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const html = await response.text();
  const start = html.indexOf('<script id="vike_pageContext" type="application/json">');
  if (start === -1) throw new Error('PWHL schedule data missing');
  const first = html.indexOf('>', start) + 1;
  const last = html.indexOf('</script>', first);
  const content = JSON.parse(html.slice(first, last)).props?.pageData?.content;
  const schedules = content?.flatMap(block => block.schedule_block?.schedule ?? []);
  if (!schedules?.length) throw new Error('PWHL schedule data missing');
  return schedules.flatMap(schedule => schedule.games || []).flatMap(game => {
    const home = game.home_team?.home_team_name;
    const away = game.visiting_team?.visiting_team_name;
    if (!game.game_id || !home || !away) return [];
    const teamCase = name => name.toLowerCase().replace(/(^|\s)\p{L}/gu, initial => initial.toUpperCase());
    return [{
      idEvent: `pwhl:${game.game_id}`, strTimestamp: game.date_played, strLeague: 'PWHL', strSport: 'Ice Hockey',
      strHomeTeam: teamCase(home), strAwayTeam: teamCase(away),
      strHomeTeamBadge: pwhlLogo(game.home_team, 'home_team_logo'),
      strAwayTeamBadge: pwhlLogo(game.visiting_team, 'visiting_team_logo'),
      strStatus: /^final/i.test(game.game_status) ? 'finished' : game.game_status
    }];
  });
}

export async function fetchApiSports(key, date, fetchImpl = fetch) {
  if (!key) return { rows: [], failed: false };
  const results = await Promise.allSettled(apiSports.map(async ([endpoint, sport]) => {
    const url = new URL(endpoint);
    url.search = new URLSearchParams({ date, timezone: 'America/Toronto' });
    const response = await fetchImpl(url.href, {
      headers: { 'x-apisports-key': key.trim(), accept: 'application/json' },
      redirect: 'manual', signal: AbortSignal.timeout(6500)
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    if (!Array.isArray(data.response) || Object.keys(data.errors || {}).length) throw new Error('API-Sports returned an error');
    return data.response.flatMap(game => {
      const home = game.teams?.home;
      const away = game.teams?.away;
      const name = game.league?.name;
      const competition = sport === 'Soccer' && soccerLeagues.has(game.league?.id)
        ? name?.replace(/^UEFA /i, '') : name;
      const supported = sport === 'Soccer' ? soccerLeagues.has(game.league?.id)
        : sport === 'Basketball' ? /^(?:NBA|WNBA)$/i.test(name)
        : sport === 'Ice Hockey' ? /^(?:NHL|PWHL)$/i.test(name)
        : /\b(?:six nations|top 14|premiership|united rugby championship|super rugby|rugby world cup)\b/i.test(name);
      const fixture = game.fixture || game;
      if (!supported || !fixture.id || !home?.name || !away?.name) return [];
      const status = fixture.status?.short || '';
      return [{
        idEvent: `apisports:${sport}:${fixture.id}`, strTimestamp: fixture.date, strSport: sport, strLeague: competition,
        strHomeTeam: home.name, strAwayTeam: away.name, strHomeTeamBadge: home.logo, strAwayTeamBadge: away.logo,
        strStatus: /^(?:FT|AET|PEN|AOT|AP|AWD|WO)$/.test(status) ? 'finished'
          : /^(?:PST|CANC|ABD|SUSP)$/.test(status) ? 'postponed'
          : /^(?:1H|2H|HT|ET|LIVE|Q[1-4]|P[1-3]|OT|BT|PT|INTR|P)$/.test(status) ? 'live' : ''
      }];
    });
  }));
  return { rows: results.flatMap(result => result.status === 'fulfilled' ? result.value : []),
    failed: results.some(result => result.status === 'rejected') };
}
