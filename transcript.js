/**
 * Custom YouTube transcript fetcher optimized for serverless environments.
 * Uses multiple strategies with GDPR consent bypass.
 */

const INNERTUBE_API = 'https://www.youtube.com/youtubei/v1/player?prettyPrint=false';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const CONSENT_COOKIE = 'SOCS=CAISNQgDEitib3FfaWRlbnRpdHlmcm9udGVuZHVpc2VydmVyXzIwMjQwNDAxLjA4X3AxGgJmciACGgYIgJnZsgY; CONSENT=PENDING+987; YSC=DwKYllHNwuw';

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

function extractTracksFromHtml(html) {
  // Try multiple patterns to find player response in the HTML
  const patterns = [
    /ytInitialPlayerResponse\s*=\s*(\{.+?\})\s*;\s*(?:var\s|<\/script>|const\s|let\s)/s,
    /ytInitialPlayerResponse\s*=\s*(\{.+?\})\s*;/s,
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) {
      try {
        const data = JSON.parse(match[1]);
        const tracks = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
        if (Array.isArray(tracks) && tracks.length > 0) return tracks;
      } catch { continue; }
    }
  }

  // Try to find captions directly in the HTML
  const captionMatch = html.match(/"captionTracks":\s*(\[.+?\])/);
  if (captionMatch) {
    try {
      const tracks = JSON.parse(captionMatch[1]);
      if (Array.isArray(tracks) && tracks.length > 0) return tracks;
    } catch { /* ignore */ }
  }

  return null;
}

// Strategy 1: Scrape YouTube watch page (most reliable from cloud)
async function fetchViaWebPage(videoId) {
  try {
    const response = await fetch(`https://www.youtube.com/watch?v=${videoId}&hl=fr&has_verified=1&bpctr=9999999999`, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept-Language': 'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Cookie': CONSENT_COOKIE,
      },
    });
    if (!response.ok) { console.log(`[Transcript] WebPage: HTTP ${response.status}`); return null; }
    const html = await response.text();
    console.log(`[Transcript] WebPage: got ${html.length} chars, has captionTracks: ${html.includes('captionTracks')}, has recaptcha: ${html.includes('g-recaptcha')}`);
    return extractTracksFromHtml(html);
  } catch (e) { console.log(`[Transcript] WebPage error: ${e.message}`); return null; }
}

// Strategy 2: InnerTube WEB client
async function fetchViaInnerTubeWeb(videoId) {
  try {
    const response = await fetch(INNERTUBE_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': USER_AGENT,
        'Cookie': CONSENT_COOKIE,
      },
      body: JSON.stringify({
        context: { client: { clientName: 'WEB', clientVersion: '2.20240313.05.00', hl: 'fr' } },
        videoId,
      }),
    });
    if (!response.ok) { console.log(`[Transcript] InnerTube WEB: HTTP ${response.status}`); return null; }
    const data = await response.json();
    const tracks = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
    console.log(`[Transcript] InnerTube WEB: tracks=${tracks?.length || 0}, playability=${data?.playabilityStatus?.status}`);
    return Array.isArray(tracks) && tracks.length > 0 ? tracks : null;
  } catch (e) { console.log(`[Transcript] InnerTube WEB error: ${e.message}`); return null; }
}

// Strategy 3: InnerTube ANDROID client
async function fetchViaInnerTubeAndroid(videoId) {
  try {
    const response = await fetch(INNERTUBE_API, {
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
    if (!response.ok) { console.log(`[Transcript] InnerTube ANDROID: HTTP ${response.status}`); return null; }
    const data = await response.json();
    const tracks = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
    console.log(`[Transcript] InnerTube ANDROID: tracks=${tracks?.length || 0}, playability=${data?.playabilityStatus?.status}`);
    return Array.isArray(tracks) && tracks.length > 0 ? tracks : null;
  } catch (e) { console.log(`[Transcript] InnerTube ANDROID error: ${e.message}`); return null; }
}

// Strategy 4: Direct timedtext API
async function fetchViaTimedText(videoId, lang) {
  const langs = [lang, 'fr', 'en'].filter(Boolean);
  for (const l of langs) {
    try {
      const url = `https://www.youtube.com/api/timedtext?v=${videoId}&lang=${l}&fmt=srv3`;
      const response = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT, 'Cookie': CONSENT_COOKIE },
      });
      if (!response.ok) continue;
      const xml = await response.text();
      console.log(`[Transcript] TimedText (${l}): got ${xml.length} chars`);
      if (xml.length < 100) continue;
      const transcript = parseTranscriptXml(xml);
      if (transcript.length > 0) return transcript;
    } catch { continue; }
  }
  return null;
}

async function fetchTranscriptFromTracks(tracks, lang) {
  if (!Array.isArray(tracks) || tracks.length === 0) return null;

  let track = lang ? tracks.find(t => t.languageCode === lang) : null;
  if (!track) track = tracks.find(t => t.languageCode === 'fr');
  if (!track) track = tracks[0];
  if (!track?.baseUrl) return null;

  console.log(`[Transcript] Fetching track: ${track.languageCode} - ${track.baseUrl.substring(0, 80)}...`);

  const response = await fetch(track.baseUrl, {
    headers: { 'User-Agent': USER_AGENT, 'Cookie': CONSENT_COOKIE },
  });
  if (!response.ok) return null;

  const xml = await response.text();
  return parseTranscriptXml(xml);
}

/**
 * Fetch YouTube transcript with multiple fallback strategies.
 */
export async function getTranscript(videoId, lang) {
  console.log(`[Transcript] Starting for video: ${videoId}`);

  // Strategy 1: Direct TimedText API (simplest, no parsing needed)
  const directResult = await fetchViaTimedText(videoId, lang);
  if (directResult && directResult.length > 0) {
    console.log(`[Transcript] Success via TimedText (${directResult.length} segments)`);
    return directResult;
  }

  // Strategy 2-4: Get caption tracks then fetch
  const strategies = [
    { name: 'WebPage', fn: () => fetchViaWebPage(videoId) },
    { name: 'InnerTube WEB', fn: () => fetchViaInnerTubeWeb(videoId) },
    { name: 'InnerTube ANDROID', fn: () => fetchViaInnerTubeAndroid(videoId) },
  ];

  for (const strategy of strategies) {
    const tracks = await strategy.fn();
    if (tracks && tracks.length > 0) {
      const transcript = await fetchTranscriptFromTracks(tracks, lang);
      if (transcript && transcript.length > 0) {
        console.log(`[Transcript] Success via ${strategy.name} (${transcript.length} segments)`);
        return transcript;
      }
    }
  }

  throw new Error("Impossible de récupérer la transcription. Vérifie que la vidéo a des sous-titres activés.");
}
