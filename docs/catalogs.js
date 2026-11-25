export const sports = [
  ['soccer', 'Soccer', '⚽'], ['football', 'American Football', '🏈'],
  ['basketball', 'Basketball', '🏀'], ['hockey', 'Hockey', '🏒'],
  ['baseball', 'Baseball', '⚾'], ['mma', 'Combat Sports', '🥊'],
  ['tennis', 'Tennis', '🎾'], ['motorsport', 'Motorsport', '🏎️'],
  ['rugby', 'Rugby', '🏉'], ['other', 'Other Sports', '🏅']
];

export const catalogs = [
  { id: 'live_now', name: '🔴 Live Now', extra: [{ name: 'genre', isRequired: false }] },
  { id: 'upcoming_today', name: 'Upcoming Today', extra: [] },
  ...sports.map(([id, name, icon]) => ({ id: `sport_${id}`, name: `${icon} ${name}`, extra: [], sport: id })),
  ...[
    ['NBA', 'basketball', '🏀'], ['WNBA', 'basketball', '🏀'],
    ['NHL', 'hockey', '🏒'], ['PWHL', 'hockey', '🏒'],
    ['NFL', 'football', '🏈'], ['MLB', 'baseball', '⚾']
  ].map(([league, sport, icon]) => ({ id: `league_${league.toLowerCase()}`, name: `${icon} ${league}`, extra: [], sport, league }))
];

export const standardCatalogs = catalogs.filter(catalog => !catalog.league);

export function enabledCatalogs(value = '') {
  const selected = new Set(String(value).split(',').map(id => id.trim()));
  const matches = catalogs.filter(catalog => selected.has(catalog.id));
  return matches.length ? matches : standardCatalogs;
}
