const PLAYLIST_HOSTS = new Set([
  'nuviosports.xyz', 'stream.nuviosports.xyz', 'sports.highfly.to',
  'live-pull.aisports.mobi', 'sonyeventsglobal.akamaized.net'
]);
const MAX_PROBES = 6;
const MAX_PLAYLIST_BYTES = 65536;

function resolution(value) {
  return Number(String(value ?? '').match(/\b(2160|1440|1080|720|576|540|480|360|240)p\b/i)?.[1])
    || (/\b(?:4k|uhd)\b/i.test(value) ? 2160 : 0);
}

function advertisedQuality(stream) {
  const label = [stream.resolution, stream.name, stream.title, stream.description].filter(Boolean).join(' ');
  const bitrate = label.match(/\b(\d+(?:\.\d+)?)\s*(mbps|kbps)\b/i);
  return {
    height: Number(stream.height) || resolution(label),
    bitrate: Number(stream.bitrate) || (bitrate ? Number(bitrate[1]) * (bitrate[2].toLowerCase() === 'mbps' ? 1e6 : 1e3) : 0),
    bitrateType: 'reported'
  };
}

function playlistQuality(text) {
  const variants = [...text.matchAll(/^#EXT-X-STREAM-INF:([^\r\n]+)/gm)].map(([, attributes]) => {
    const height = Number(attributes.match(/(?:^|,)RESOLUTION=\d+x(\d+)/)?.[1]) || 0;
    const average = Number(attributes.match(/(?:^|,)AVERAGE-BANDWIDTH=(\d+)/)?.[1]) || 0;
    const peak = Number(attributes.match(/(?:^|,)BANDWIDTH=(\d+)/)?.[1]) || 0;
    return { height, bitrate: average || peak, bitrateType: average ? 'avg' : 'peak' };
  }).sort((a, b) => b.height - a.height || b.bitrate - a.bitrate);
  return variants.length ? { ...variants[0], adaptive: variants.length > 1 } : null;
}

function playlistUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' && !url.username && !url.password && !url.port
        && PLAYLIST_HOSTS.has(url.hostname) && /\.m3u8$/i.test(url.pathname)) return url.href;
  } catch {
    return null;
  }
  return null;
}

async function readPlaylist(url) {
  try {
    const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(1200) });
    if (!response.ok || !response.body || Number(response.headers.get('content-length')) > MAX_PLAYLIST_BYTES) return null;
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let text = '';
    let size = 0;
    try {
      while (size <= MAX_PLAYLIST_BYTES) {
        const { value, done } = await reader.read();
        if (done) return text.startsWith('#EXTM3U') ? playlistQuality(text + decoder.decode()) : null;
        size += value.byteLength;
        if (size <= MAX_PLAYLIST_BYTES) text += decoder.decode(value, { stream: true });
      }
    } finally {
      if (size > MAX_PLAYLIST_BYTES) await reader.cancel().catch(() => {});
    }
  } catch {
    return null;
  }
  return null;
}

export async function rankStreams(candidates) {
  const entries = candidates.map(candidate => ({ ...candidate, quality: advertisedQuality(candidate.stream) }));
  const probes = new Map();
  for (const entry of entries) {
    const url = !entry.quality.bitrate && playlistUrl(entry.stream.url);
    if (!url) continue;
    if (!probes.has(url) && probes.size < MAX_PROBES) probes.set(url, readPlaylist(url));
    entry.probe = probes.get(url);
  }
  await Promise.all(entries.map(async entry => {
    const playlist = await entry.probe;
    if (playlist) entry.quality = { ...playlist, height: playlist.height || entry.quality.height };
  }));

  return entries.sort((a, b) => b.quality.height - a.quality.height
    || Number(b.language === 'english') - Number(a.language === 'english')
    || b.quality.bitrate - a.quality.bitrate)
    .map(({ stream, provider, language, languageLabel, quality }) => {
      const { name, title, description, ...playback } = stream;
      const resolutionLabel = quality.height ? `${quality.adaptive ? 'Up to ' : ''}${quality.height}p` : 'Quality unknown';
      const bitrateLabel = quality.bitrate ? `${Number((quality.bitrate / 1e6).toFixed(2))} Mbps ${quality.bitrateType}` : 'Bitrate unknown';
      const details = [...new Set([name, title, description].filter(Boolean)), `Addon: ${provider}`].join('\n');
      return { ...playback, name: [resolutionLabel, bitrateLabel, languageLabel || (language === 'english' ? 'English' : 'Language unverified')].join(' · '), description: details };
    });
}
