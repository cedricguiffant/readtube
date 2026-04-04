import express from 'express';
import cors from 'cors';
import { reformulate } from './reformulate.js';
import { fetchTranscript } from 'youtube-transcript/dist/youtube-transcript.esm.js';

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('.'));

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
  const { url } = req.body;

  if (!url) {
    return res.status(400).json({ error: "URL YouTube requise" });
  }

  try {
    const videoId = extractVideoId(url);
    if (!videoId) {
      return res.status(400).json({ error: "URL YouTube invalide" });
    }

    console.log(`Récupération de la transcription pour ${videoId}...`);
    const [transcriptData, title] = await Promise.all([
      fetchTranscript(videoId),
      fetchVideoTitle(videoId)
    ]);

    const rawText = transcriptData
      .map(item => item.text)
      .join(' ');

    console.log(`Reformulation avec Claude (${rawText.length} caractères)...`);
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
});

function extractVideoId(url) {
  const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\n?#]+)/);
  return match ? match[1] : null;
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Serveur pret sur http://localhost:${PORT}`);
});
