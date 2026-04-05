import { reformulate } from '../reformulate.js';

async function fetchVideoTitle(videoId) {
  try {
    const res = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`);
    if (!res.ok) return null;
    const data = await res.json();
    return data.title;
  } catch { return null; }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { rawText, videoId } = req.body;

  if (!rawText || !videoId) {
    return res.status(400).json({ error: "rawText et videoId requis" });
  }

  try {
    const title = await fetchVideoTitle(videoId);
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
