import { reformulate } from '../reformulate.js';
import { fetchTranscript } from 'youtube-transcript/dist/youtube-transcript.esm.js';

function extractVideoId(url) {
  const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\n?#]+)/);
  return match ? match[1] : null;
}

async function fetchVideoTitle(videoId) {
  try {
    const res = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`);
    if (!res.ok) return null;
    const data = await res.json();
    return data.title;
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { url } = req.body;

  if (!url) {
    return res.status(400).json({ error: "URL YouTube requise" });
  }

  try {
    const videoId = extractVideoId(url);
    if (!videoId) {
      return res.status(400).json({ error: "URL YouTube invalide" });
    }

    const [transcriptData, title] = await Promise.all([
      fetchTranscript(videoId),
      fetchVideoTitle(videoId)
    ]);

    const rawText = transcriptData
      .map(item => item.text)
      .join(' ');

    const formattedText = await reformulate(rawText);

    res.json({
      success: true,
      videoId,
      title,
      rawTextLength: rawText.length,
      formattedText
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({
      error: "Erreur lors du traitement",
      message: error.message
    });
  }
}
