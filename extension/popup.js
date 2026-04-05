const API_URL = 'https://readtube-nine.vercel.app/api/process-video';
const SITE_URL = 'https://readtube-nine.vercel.app';

document.addEventListener('DOMContentLoaded', async () => {
  const formSection = document.getElementById('formSection');
  const loading = document.getElementById('loading');
  const error = document.getElementById('error');
  const btnTransform = document.getElementById('btnTransform');
  const btnRetry = document.getElementById('btnRetry');
  const videoTitle = document.getElementById('videoTitle');
  const loadingText = document.getElementById('loadingText');
  const errorText = document.getElementById('errorText');
  const transcriptInput = document.getElementById('transcriptInput');

  // Get the active tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  // Show video title if on YouTube
  let videoId = null;
  if (tab.url && tab.url.includes('youtube.com/watch')) {
    const url = new URL(tab.url);
    videoId = url.searchParams.get('v');
    videoTitle.textContent = tab.title.replace(' - YouTube', '').trim();
  } else {
    videoTitle.textContent = 'Colle la transcription d\'une vidéo YouTube';
  }

  function cleanTranscript(raw) {
    return raw
      .replace(/\d{1,2}:\d{2}(:\d{2})?\s*/g, '')
      .replace(/\n+/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  async function startTransform() {
    const raw = transcriptInput.value.trim();
    if (!raw) return;

    const rawText = cleanTranscript(raw);
    if (rawText.length < 50) {
      errorText.textContent = 'La transcription semble trop courte.';
      error.classList.remove('hidden');
      return;
    }

    formSection.classList.add('hidden');
    error.classList.add('hidden');
    loading.classList.remove('hidden');
    loadingText.textContent = 'Reformulation avec l\'IA...';

    try {
      const response = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rawText,
          videoId: videoId || 'manual'
        })
      });

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.message || data.error || 'Erreur API');
      }

      // Open result on the site
      const resultData = encodeURIComponent(JSON.stringify(data));
      chrome.tabs.create({ url: `${SITE_URL}#result=${resultData}` });

    } catch (err) {
      loading.classList.add('hidden');
      formSection.classList.remove('hidden');
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
