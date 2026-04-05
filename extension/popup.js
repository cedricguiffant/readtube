const API_URL = 'https://readtube-nine.vercel.app/api/process-video';
const SITE_URL = 'https://readtube-nine.vercel.app';

document.addEventListener('DOMContentLoaded', async () => {
  const notYoutube = document.getElementById('notYoutube');
  const videoInfo = document.getElementById('videoInfo');
  const loading = document.getElementById('loading');
  const error = document.getElementById('error');
  const btnTransform = document.getElementById('btnTransform');
  const btnRetry = document.getElementById('btnRetry');
  const videoTitle = document.getElementById('videoTitle');
  const loadingText = document.getElementById('loadingText');
  const errorText = document.getElementById('errorText');

  // Get the active tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  // Check if we're on a YouTube video page
  if (!tab.url || !tab.url.includes('youtube.com/watch')) {
    notYoutube.classList.remove('hidden');
    return;
  }

  // Show video info panel
  videoInfo.classList.remove('hidden');

  // Get video title from the tab
  videoTitle.textContent = tab.title.replace(' - YouTube', '').trim();

  async function startTransform() {
    videoInfo.classList.add('hidden');
    error.classList.add('hidden');
    loading.classList.remove('hidden');
    loadingText.textContent = 'Extraction de la transcription...';

    try {
      // Ask content script to extract the transcript
      const transcriptResponse = await chrome.tabs.sendMessage(tab.id, { action: 'getTranscript' });

      if (!transcriptResponse || !transcriptResponse.success) {
        throw new Error(transcriptResponse?.error || 'Impossible d\'extraire la transcription. La vidéo a-t-elle des sous-titres ?');
      }

      loadingText.textContent = 'Reformulation avec l\'IA...';

      // Send transcript to the API
      const response = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rawText: transcriptResponse.transcript,
          videoId: transcriptResponse.videoId
        })
      });

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.message || data.error || 'Erreur API');
      }

      // Store result and open in new tab
      const resultData = encodeURIComponent(JSON.stringify(data));
      chrome.tabs.create({ url: `${SITE_URL}#result=${resultData}` });

    } catch (err) {
      loading.classList.add('hidden');
      error.classList.remove('hidden');
      errorText.textContent = err.message;
    }
  }

  btnTransform.addEventListener('click', startTransform);
  btnRetry.addEventListener('click', () => {
    error.classList.add('hidden');
    startTransform();
  });
});
