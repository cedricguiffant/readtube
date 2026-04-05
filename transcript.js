/**
 * Custom YouTube transcript fetcher optimized for serverless environments.
 * Uses multiple strategies to bypass YouTube restrictions on cloud IPs.
 */

const INNERTUBE_API = 'https://www.youtube.com/youtubei/v1/player?prettyPrint=false';
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

  // Try new format: <p t="..." d="..."><s>...</s></p>
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

  // Fallback: old format <text start="..." dur="...">...</text>
  const textRegex = /<text start="([^"]*)" dur="([^"]*)">([^<]*)<\/text>/g;
  while ((match = textRegex.exec(xml)) !== null) {
    const text = decodeEntities(match[3]).trim();
    if (text) results.push({ text, offset: parseFloat(match[1]), duration: parseFloat(match[2]) });
  }

  return results;
}

// Strategy 1: InnerTube WEB client
async function fetchViaInnerTubeWeb(videoId) {
  try {
    const response = await fetch(INNERTUBE_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': USER_AGENT },
      body: JSON.stringify({
        context: { client: { clientName: 'WEB', clientVersion: '2.20240313.05.00' } },
        videoId,
      }),
    });
    if (!response.ok) return null;
    const data = await response.json();
    return data?.captions?.playerCaptionsTracklistRenderer?.captionTracks || null;
  } catch { return null; }
}

// Strategy 2: InnerTube ANDROID client
async function fetchViaInnerTubeAndroid(videoId) {
  try {
    const response = await fetch(INNERTUBE_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'com.google.android.youtube/20.10.38 (Linux; U; Android 14)',
      },
      body: JSON.stringify({
        context: { client: { clientName: 'ANDROID', clientVersion: '20.10.38' } },
        videoId,
      }),
    });
    if (!response.ok) return null;
    const data = await response.json();
    return data?.captions?.playerCaptionsTracklistRenderer?.captionTracks || null;
  } catch { return null; }
}

// Strategy 3: Scrape the YouTube watch page HTML
async function fetchViaWebPage(videoId) {
  try {
    const response = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept-Language': 'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });
    if (!response.ok) return null;
    const html = await response.text();

    // Extract ytInitialPlayerResponse from the page
    const patterns = [
      /var\s+ytInitialPlayerResponse\s*=\s*(\{.+?\});\s*(?:var|<\/script>)/s,
      /ytInitialPlayerResponse\s*=\s*(\{.+?\});\s*(?:var|<\/script>)/s,
    ];

    let playerData = null;
    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (match) {
        try { playerData = JSON.parse(match[1]); break; } catch { continue; }
      }
    }

    if (!playerData) return null;
    return playerData?.captions?.playerCaptionsTracklistRenderer?.captionTracks || null;
  } catch { return null; }
}

// Strategy 4: InnerTube iOS client
async function fetchViaInnerTubeIOS(videoId) {
  try {
    const response = await fetch(INNERTUBE_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'com.google.ios.youtube/20.10.38 (iPhone16,2; U; CPU iOS 17_5_1 like Mac OS X;)',
      },
      body: JSON.stringify({
        context: { client: { clientName: 'IOS', clientVersion: '20.10.38' } },
        videoId,
      }),
    });
    if (!response.ok) return null;
    const data = await response.json();
    return data?.captions?.playerCaptionsTracklistRenderer?.captionTracks || null;
  } catch { return null; }
}

async function fetchTranscriptFromTracks(tracks, lang) {
  if (!Array.isArray(tracks) || tracks.length === 0) return null;

  // Prefer requested language, then 'fr', then first available
  let track = lang ? tracks.find(t => t.languageCode === lang) : null;
  if (!track) track = tracks.find(t => t.languageCode === 'fr');
  if (!track) track = tracks[0];
  if (!track?.baseUrl) return null;

  const response = await fetch(track.baseUrl, {
    headers: { 'User-Agent': USER_AGENT },
  });
  if (!response.ok) return null;

  const xml = await response.text();
  return parseTranscriptXml(xml);
}

/**
 * Fetch YouTube transcript with multiple fallback strategies.
 * @param {string} videoId - YouTube video ID
 * @param {string} [lang] - Preferred language code (e.g. 'fr')
 * @returns {Promise<Array<{text: string, offset: number, duration: number}>>}
 */
export async function getTranscript(videoId, lang) {
  const strategies = [
    { name: 'InnerTube WEB', fn: () => fetchViaInnerTubeWeb(videoId) },
    { name: 'InnerTube ANDROID', fn: () => fetchViaInnerTubeAndroid(videoId) },
    { name: 'InnerTube IOS', fn: () => fetchViaInnerTubeIOS(videoId) },
    { name: 'Web Page Scraping', fn: () => fetchViaWebPage(videoId) },
  ];

  for (const strategy of strategies) {
    console.log(`[Transcript] Trying: ${strategy.name}...`);
    const tracks = await strategy.fn();
    if (tracks && tracks.length > 0) {
      console.log(`[Transcript] ${strategy.name} found ${tracks.length} track(s)`);
      const transcript = await fetchTranscriptFromTracks(tracks, lang);
      if (transcript && transcript.length > 0) {
        console.log(`[Transcript] Success via ${strategy.name} (${transcript.length} segments)`);
        return transcript;
      }
    }
  }

  throw new Error("Impossible de récupérer la transcription. Vérifie que la vidéo a des sous-titres activés.");
}
