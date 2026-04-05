/**
 * Custom YouTube transcript fetcher optimized for serverless environments.
 * Uses multiple strategies to bypass YouTube restrictions on cloud IPs.
 */

const INNERTUBE_API = 'https://www.youtube.com/youtubei/v1/player?prettyPrint=false';
const INNERTUBE_CLIENT_VERSION = '2.20240313.05.00';

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

  // Try new format first: <p t="..." d="..."><s>...</s></p>
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

async function fetchViaInnerTubeWeb(videoId) {
  const response = await fetch(INNERTUBE_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    },
    body: JSON.stringify({
      context: {
        client: {
          clientName: 'WEB',
          clientVersion: INNERTUBE_CLIENT_VERSION,
        }
      },
      videoId,
    }),
  });

  if (!response.ok) return null;

  const data = await response.json();
  const tracks = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
  if (!Array.isArray(tracks) || tracks.length === 0) return null;

  return tracks;
}

async function fetchViaInnerTubeAndroid(videoId) {
  const response = await fetch(INNERTUBE_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'com.google.android.youtube/20.10.38 (Linux; U; Android 14)',
    },
    body: JSON.stringify({
      context: {
        client: {
          clientName: 'ANDROID',
          clientVersion: '20.10.38',
        }
      },
      videoId,
    }),
  });

  if (!response.ok) return null;

  const data = await response.json();
  const tracks = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
  if (!Array.isArray(tracks) || tracks.length === 0) return null;

  return tracks;
}

async function fetchTranscriptFromTracks(tracks, lang) {
  // Prefer the requested language, fallback to first track
  let track = lang ? tracks.find(t => t.languageCode === lang) : null;
  if (!track) track = tracks.find(t => t.languageCode === 'fr');
  if (!track) track = tracks[0];

  if (!track?.baseUrl) return null;

  const response = await fetch(track.baseUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    },
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
  // Strategy 1: InnerTube WEB client
  let tracks = await fetchViaInnerTubeWeb(videoId);
  if (tracks) {
    const transcript = await fetchTranscriptFromTracks(tracks, lang);
    if (transcript && transcript.length > 0) return transcript;
  }

  // Strategy 2: InnerTube ANDROID client
  tracks = await fetchViaInnerTubeAndroid(videoId);
  if (tracks) {
    const transcript = await fetchTranscriptFromTracks(tracks, lang);
    if (transcript && transcript.length > 0) return transcript;
  }

  throw new Error("Impossible de récupérer la transcription. Vérifie que la vidéo a des sous-titres activés.");
}
