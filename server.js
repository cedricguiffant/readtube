import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { reformulate } from './reformulate.js';
import { getTranscript } from './transcript.js';

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('.'));

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

app.post('/api/process-video', async (req, res) => {
  const { rawText, videoId, url } = req.body;

  // Mode 1: rawText provided directly (from extension)
  if (rawText) {
    const vid = videoId || 'manual';
    try {
      const title = vid !== 'manual' ? await fetchVideoTitle(vid) : null;
      console.log(`Reformulation directe (${rawText.length} caractères)...`);
      const formattedText = await reformulate(rawText);

      return res.json({
        success: true,
        videoId: vid,
        title,
        rawTextLength: rawText.length,
        formattedText
      });
    } catch (error) {
      console.error(error);
      return res.status(500).json({
        error: "Erreur lors du traitement",
        message: error.message
      });
    }
  }

  // Mode 2: URL provided (from website - fetch transcript server-side)
  if (url) {
    const vid = extractVideoId(url);
    if (!vid) {
      return res.status(400).json({ error: "URL YouTube invalide" });
    }

    try {
      const title = await fetchVideoTitle(vid);
      console.log(`Récupération de la transcription pour ${vid}...`);
      const segments = await getTranscript(vid);
      const transcript = segments.map(s => s.text).join(' ');

      console.log(`Reformulation (${transcript.length} caractères)...`);
      const formattedText = await reformulate(transcript);

      return res.json({
        success: true,
        videoId: vid,
        title,
        rawTextLength: transcript.length,
        formattedText
      });
    } catch (error) {
      console.error(error);
      return res.status(500).json({
        error: "Erreur lors du traitement",
        message: error.message
      });
    }
  }

  return res.status(400).json({ error: "rawText ou url requis" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Serveur pret sur http://localhost:${PORT}`);
});
