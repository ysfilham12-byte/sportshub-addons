import { languages } from '../docs/languages.js';

const fields = ['language', 'lang', 'audioLanguage', 'audio_language', 'audioLang', 'audio_lang', 'languages', 'audioLanguages', 'audio_languages'];
const normalize = value => String(value ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const codeByAlias = new Map();
const labelByCode = new Map();
for (const [code, label, aliases] of languages) {
  labelByCode.set(code, label);
  for (const alias of [code, label, ...aliases.split(' ')]) codeByAlias.set(normalize(alias), code);
}
const englishBroadcaster = /\b(sky sports|espn(?! deportes)|tnt sports|fox sports|nbc sports|cbs sports|sportsnet|tsn|willow(?: sports)?|bbc sport|itv sport|premier sports|bt sport)\b/i;

function values(value) {
  if (Array.isArray(value)) return value.flatMap(values);
  if (value && typeof value === 'object') return ['code', 'name', 'language', 'lang', 'value'].flatMap(key => values(value[key]));
  return normalize(value).match(/[\p{L}]{2,}/gu) || [];
}

export function classifyLanguage(stream) {
  const label = [stream?.name, stream?.title, stream?.description].filter(Boolean).join(' ');
  const codes = new Set();
  for (const token of fields.flatMap(field => values(stream?.[field]))) {
    if (codeByAlias.has(token)) codes.add(codeByAlias.get(token));
  }
  for (const word of normalize(label).match(/[\p{L}]{3,}/gu) || []) {
    if (codeByAlias.has(word)) codes.add(codeByAlias.get(word));
  }
  for (const [, marker] of normalize(label).matchAll(/[\[(]([a-z]{2})(?:[-_][a-z]{2})?[\])]/g)) {
    if (codeByAlias.has(marker)) codes.add(codeByAlias.get(marker));
  }
  if (!codes.size && (/\ben[-_](?:us|gb|ca|au)\b/i.test(label) || englishBroadcaster.test(label))) codes.add('en');
  const list = [...codes];
  return {
    codes: list,
    language: list.length === 1 && list[0] === 'en' ? 'english' : list.length ? 'other' : 'unknown',
    languageLabel: list.length ? list.map(code => labelByCode.get(code)).join(' / ') : 'Language unverified'
  };
}

export function streamLanguageAllowed({ codes, language }, preference = '') {
  const selected = new Set(String(preference).toLowerCase().split(',').map(value => value.trim()));
  if (selected.has('any')) return true;
  const known = [...selected].filter(code => labelByCode.has(code));
  if (selected.has('english')) return language === 'english' || (language === 'unknown' && selected.has('unknown'));
  if (known.length) return codes.some(code => selected.has(code)) || (language === 'unknown' && selected.has('unknown'));
  return language !== 'other';
}
