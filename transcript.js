/**
 * YouTube transcript fetcher for serverless environments.
 * Uses third-party APIs as primary strategy (YouTube blocks cloud IPs directly).
 * Falls back to direct YouTube APIs for local development.
 */

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

function decodeEntities(text) {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)));
}

function parseTranscriptXml(xml) {
  const results = [];

  // New format: <p t="..." d="..."><s>...</s></p>
  const pRegex = /<p\s+t="(\d+)"\s+d="(\d+)"[^>]*>([\s\S]*?)<\/p>/g;
  let match;
  while ((match = pRegex.exec(xml)) !== null) {
    let text = '';
    const sRegex = /<s[^>]*>([^<]*)<\/s>/g;
    let sMatch;
    while ((sMatch = sRegex.exec(match[3])) !== null) {
      text += sMatch[1];
    }
    if (!text) text = match[3].replace(/<[^>]+>/g, '');
    text = decodeEntities(text).trim();
    if (text) results.push({ text, offset: parseInt(match[1]), duration: parseInt(match[2]) });
  }
  if (results.length > 0) return results;

  // Old format: <text start="..." dur="...">...</text>
  const textRegex = /<text start="([^"]*)" dur="([^"]*)">([^<]*)<\/text>/g;
  while ((match = textRegex.exec(xml)) !== null) {
    const text = decodeEntities(match[3]).trim();
    if (text) results.push({ text, offset: parseFloat(match[1]), duration: parseFloat(match[2]) });
  }
  return results;
}

// ── Strategy 1: Kome.ai free transcript API ──
async function fetchViaKomeAi(videoId) {
  try {
    const response = await fetch('https://api.kome.ai/api/tools/youtube-transcripts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ video_id: videoId, format: false }),
    });
    if (!response.ok) return null;
    const data = await response.json();

    // Kome returns { transcript: "full text" } or { data: [...] }
    if (data?.transcript && typeof data.transcript === 'string') {
      return [{ text: data.transcript, offset: 0, duration: 0 }];
    }
    if (Array.isArray(data?.data)) {
      return data.data.map(item => ({
        text: item.text || item.content || '',
        offset: item.start || item.offset || 0,
        duration: item.duration || 0,
      })).filter(item => item.text);
    }
    // Try treating the whole response as text segments
    if (Array.isArray(data)) {
      return data.map(item => ({
        text: item.text || item.content || '',
        offset: item.start || item.offset || 0,
        duration: item.duration || 0,
      })).filter(item => item.text);
    }
    return null;
  } catch { return null; }
}

// ── Strategy 2: Tactiq free transcript API ──
async function fetchViaTactiq(videoId) {
  try {
    const response = await fetch(`https://tactiq-apps-prod.tactiq.io/transcript`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ videoUrl: `https://www.youtube.com/watch?v=${videoId}`, langCode: 'fr' }),
    });
    if (!response.ok) return null;
    const data = await response.json();

    if (Array.isArray(data?.captions)) {
      return data.captions.map(item => ({
        text: item.text || '',
        offset: item.start || 0,
        duration: item.dur || item.duration || 0,
      })).filter(item => item.text);
    }
    return null;
  } catch { return null; }
}

// ── Strategy 3: InnerTube ANDROID (works better from some cloud IPs) ──
async function fetchViaInnerTube(videoId) {
  try {
    const response = await fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'com.google.android.youtube/20.10.38 (Linux; U; Android 14)',
      },
      body: JSON.stringify({
        context: { client: { clientName: 'ANDROID', clientVersion: '20.10.38', hl: 'fr' } },
        videoId,
      }),
    });
    if (!response.ok) return null;
    const data = await response.json();
    const tracks = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
    if (!Array.isArray(tracks) || tracks.length === 0) return null;

    // Pick the best track
    let track = tracks.find(t => t.languageCode === 'fr') || tracks[0];
    if (!track?.baseUrl) return null;

    const xmlRes = await fetch(track.baseUrl, { headers: { 'User-Agent': USER_AGENT } });
    if (!xmlRes.ok) return null;
    return parseTranscriptXml(await xmlRes.text());
  } catch { return null; }
}

// ── Strategy 4: Direct YouTube timedtext ──
async function fetchViaTimedText(videoId) {
  const langs = ['fr', 'en'];
  for (const lang of langs) {
    try {
      const url = `https://www.youtube.com/api/timedtext?v=${videoId}&lang=${lang}&fmt=srv3`;
      const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
      if (!response.ok) continue;
      const xml = await response.text();
      if (xml.length < 100) continue;
      const result = parseTranscriptXml(xml);
      if (result.length > 0) return result;
    } catch { continue; }
  }
  return null;
}

/**
 * Fetch YouTube transcript with multiple fallback strategies.
 */
export async function getTranscript(videoId, lang) {
  const errors = [];

  const strategies = [
    { name: 'Kome.ai', fn: () => fetchViaKomeAi(videoId) },
    { name: 'Tactiq', fn: () => fetchViaTactiq(videoId) },
    { name: 'InnerTube', fn: () => fetchViaInnerTube(videoId) },
    { name: 'TimedText', fn: () => fetchViaTimedText(videoId) },
  ];

  for (const { name, fn } of strategies) {
    try {
      console.log(`[Transcript] Trying ${name}...`);
      const result = await fn();
      if (result && result.length > 0) {
        console.log(`[Transcript] Success via ${name} (${result.length} segments)`);
        return result;
      }
      console.log(`[Transcript] ${name}: no results`);
    } catch (e) {
      console.log(`[Transcript] ${name} failed: ${e.message}`);
      errors.push(`${name}: ${e.message}`);
    }
  }

  throw new Error(`Impossible de récupérer la transcription. Stratégies tentées: ${strategies.map(s => s.name).join(', ')}. Vérifie que la vidéo a des sous-titres.`);
}
