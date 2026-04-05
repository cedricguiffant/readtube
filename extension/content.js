// ReadTube Content Script - Runs on YouTube pages
// Extracts video transcripts directly from the YouTube page data

function getVideoId() {
  const url = new URL(window.location.href);
  return url.searchParams.get('v');
}

function decodeEntities(text) {
  const el = document.createElement('textarea');
  el.innerHTML = text;
  return el.value;
}

function parseTranscriptXml(xml) {
  const segments = [];

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
    if (text) segments.push(text);
  }
  if (segments.length > 0) return segments.join(' ');

  // Old format: <text start="..." dur="...">...</text>
  const textRegex = /<text start="([^"]*)" dur="([^"]*)">([^<]*)<\/text>/g;
  while ((match = textRegex.exec(xml)) !== null) {
    const text = decodeEntities(match[3]).trim();
    if (text) segments.push(text);
  }
  return segments.join(' ');
}

// Strategy 1: Extract caption tracks from ytInitialPlayerResponse in the page
function getTracksFromPageData() {
  try {
    // Try getting from ytInitialPlayerResponse (available in page scripts)
    const scripts = document.querySelectorAll('script');
    for (const script of scripts) {
      const text = script.textContent;
      if (text.includes('captionTracks')) {
        const match = text.match(/"captionTracks"\s*:\s*(\[.*?\])\s*[,}]/);
        if (match) {
          try {
            return JSON.parse(match[1]);
          } catch { continue; }
        }
      }
    }
  } catch { /* ignore */ }
  return null;
}

// Strategy 2: Extract transcript from the visible transcript panel in the DOM
function getTranscriptFromDOM() {
  // YouTube transcript panel segments
  const segments = document.querySelectorAll(
    'ytd-transcript-segment-renderer .segment-text, ' +
    'ytd-transcript-segment-renderer yt-formatted-string.segment-text, ' +
    '#segments-container ytd-transcript-segment-renderer'
  );

  if (segments.length > 0) {
    const texts = [];
    segments.forEach(el => {
      const text = el.textContent?.trim();
      if (text) texts.push(text);
    });
    if (texts.length > 0) return texts.join(' ');
  }

  // Alternative selectors
  const altSegments = document.querySelectorAll(
    '[class*="segment-text"], ' +
    'ytd-transcript-body-renderer .cue-group .cue'
  );

  if (altSegments.length > 0) {
    const texts = [];
    altSegments.forEach(el => {
      const text = el.textContent?.trim();
      if (text && !text.match(/^\d{1,2}:\d{2}/)) texts.push(text);
    });
    if (texts.length > 0) return texts.join(' ');
  }

  return null;
}

// Strategy 3: Use InnerTube API (same-origin from youtube.com)
async function getTracksFromInnerTube(videoId) {
  const configs = [
    { clientName: 'WEB', clientVersion: '2.20250401.00.00', ua: navigator.userAgent },
    { clientName: 'ANDROID', clientVersion: '20.10.38', ua: 'com.google.android.youtube/20.10.38' },
  ];

  for (const config of configs) {
    try {
      const response = await fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          context: { client: { clientName: config.clientName, clientVersion: config.clientVersion, hl: 'fr' } },
          videoId
        })
      });
      if (!response.ok) continue;
      const data = await response.json();
      const tracks = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
      if (Array.isArray(tracks) && tracks.length > 0) return tracks;
    } catch { continue; }
  }
  return null;
}

async function fetchTranscriptFromTracks(tracks) {
  // Pick French, then English, then first
  let track = tracks.find(t => t.languageCode === 'fr')
            || tracks.find(t => t.languageCode === 'en')
            || tracks[0];

  if (!track?.baseUrl) throw new Error('URL de sous-titres introuvable');

  const response = await fetch(track.baseUrl);
  if (!response.ok) throw new Error('Impossible de télécharger les sous-titres');

  const xml = await response.text();
  const transcript = parseTranscriptXml(xml);
  if (!transcript) throw new Error('Transcription vide');
  return transcript;
}

async function fetchTranscript(videoId) {
  // Strategy 1: Read transcript from the visible DOM panel (most reliable)
  const domTranscript = getTranscriptFromDOM();
  if (domTranscript && domTranscript.length > 50) {
    console.log('[ReadTube] Transcript from DOM:', domTranscript.length, 'chars');
    return domTranscript;
  }

  // Strategy 2: Extract caption tracks from page scripts
  const pageTracks = getTracksFromPageData();
  if (pageTracks && pageTracks.length > 0) {
    console.log('[ReadTube] Tracks from page data:', pageTracks.length);
    try {
      return await fetchTranscriptFromTracks(pageTracks);
    } catch (e) {
      console.log('[ReadTube] Page tracks failed:', e.message);
    }
  }

  // Strategy 3: InnerTube API
  const innerTracks = await getTracksFromInnerTube(videoId);
  if (innerTracks && innerTracks.length > 0) {
    console.log('[ReadTube] Tracks from InnerTube:', innerTracks.length);
    return await fetchTranscriptFromTracks(innerTracks);
  }

  throw new Error('Aucun sous-titre disponible pour cette vidéo');
}

// Listen for messages from the popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'getTranscript') {
    const videoId = getVideoId();

    if (!videoId) {
      sendResponse({ success: false, error: 'Aucune vidéo détectée sur cette page' });
      return true;
    }

    fetchTranscript(videoId)
      .then(transcript => {
        sendResponse({ success: true, transcript, videoId });
      })
      .catch(err => {
        sendResponse({ success: false, error: err.message });
      });

    return true;
  }
});
