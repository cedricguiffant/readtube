// ReadTube Content Script - Runs on YouTube pages
// Extracts video transcripts using YouTube's InnerTube API (same-origin, no CORS issues)

function getVideoId() {
  const url = new URL(window.location.href);
  return url.searchParams.get('v');
}

async function fetchTranscript(videoId) {
  // Step 1: Use InnerTube player endpoint to get caption tracks
  const playerResponse = await fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      context: {
        client: {
          clientName: 'WEB',
          clientVersion: '2.20240101.00.00',
          hl: 'fr'
        }
      },
      videoId: videoId
    })
  });

  if (!playerResponse.ok) {
    throw new Error('Impossible de contacter YouTube');
  }

  const playerData = await playerResponse.json();
  const tracks = playerData?.captions?.playerCaptionsTracklistRenderer?.captionTracks;

  if (!tracks || tracks.length === 0) {
    throw new Error('Aucun sous-titre disponible pour cette vidéo');
  }

  // Pick the best caption track (prefer French, fallback to first available)
  let track = tracks.find(t => t.languageCode === 'fr')
            || tracks.find(t => t.languageCode === 'en')
            || tracks[0];

  if (!track?.baseUrl) {
    throw new Error('URL de sous-titres introuvable');
  }

  // Step 2: Fetch the caption XML
  const captionUrl = track.baseUrl + '&fmt=srv3';
  const captionResponse = await fetch(captionUrl);

  if (!captionResponse.ok) {
    throw new Error('Impossible de télécharger les sous-titres');
  }

  const xml = await captionResponse.text();

  // Step 3: Parse XML to extract text
  const transcript = parseTranscriptXml(xml);

  if (!transcript || transcript.length === 0) {
    throw new Error('Transcription vide');
  }

  return transcript;
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
        sendResponse({
          success: true,
          transcript: transcript,
          videoId: videoId
        });
      })
      .catch(err => {
        sendResponse({
          success: false,
          error: err.message
        });
      });

    // Return true to indicate we'll send response asynchronously
    return true;
  }
});
