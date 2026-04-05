const API_URL = 'https://readtube-nine.vercel.app/api/process-video';

document.addEventListener('DOMContentLoaded', async () => {
  const formSection = document.getElementById('formSection');
  const loading = document.getElementById('loading');
  const error = document.getElementById('error');
  const resultSection = document.getElementById('resultSection');
  const btnTransform = document.getElementById('btnTransform');
  const btnRetry = document.getElementById('btnRetry');
  const btnCopy = document.getElementById('btnCopy');
  const btnNew = document.getElementById('btnNew');
  const btnBack = document.getElementById('btnBack');
  const videoTitle = document.getElementById('videoTitle');
  const loadingText = document.getElementById('loadingText');
  const errorText = document.getElementById('errorText');
  const transcriptInput = document.getElementById('transcriptInput');
  const resultTitle = document.getElementById('resultTitle');
  const resultText = document.getElementById('resultText');
  const statWords = document.getElementById('statWords');
  const statTime = document.getElementById('statTime');

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

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

  function showForm() {
    formSection.classList.remove('hidden');
    loading.classList.add('hidden');
    error.classList.add('hidden');
    resultSection.classList.add('hidden');
    btnBack.classList.add('hidden');
  }

  function formatText(text) {
    return text
      .split(/\n{2,}/)
      .map(p => p.trim())
      .filter(p => p.length > 0)
      .map(p => {
        if (p.startsWith('**') && p.endsWith('**')) {
          return `<h3 class="subtitle">${p.replace(/\*\*/g, '')}</h3>`;
        }
        return `<p>${p.replace(/\n/g, ' ')}</p>`;
      })
      .join('');
  }

  async function startTransform() {
    const raw = transcriptInput.value.trim();
    if (!raw) return;

    const rawText = cleanTranscript(raw);
    if (rawText.length < 50) {
      error.classList.remove('hidden');
      errorText.textContent = 'La transcription semble trop courte.';
      return;
    }

    formSection.classList.add('hidden');
    error.classList.add('hidden');
    resultSection.classList.add('hidden');
    loading.classList.remove('hidden');

    try {
      const response = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rawText, videoId: videoId || 'manual' })
      });

      const data = await response.json();
      if (!data.success) throw new Error(data.message || data.error);

      // Show result
      loading.classList.add('hidden');
      resultSection.classList.remove('hidden');
      btnBack.classList.remove('hidden');

      resultTitle.textContent = data.title || 'Vidéo YouTube';

      const words = data.formattedText.split(/\s+/).length;
      const readMin = Math.max(1, Math.round(words / 230));
      statWords.textContent = `${words.toLocaleString('fr-FR')} mots`;
      statTime.textContent = `~${readMin} min de lecture`;

      resultText.innerHTML = formatText(data.formattedText);

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

  btnCopy.addEventListener('click', () => {
    const text = resultText.innerText;
    navigator.clipboard.writeText(text).then(() => {
      const original = btnCopy.innerHTML;
      btnCopy.innerHTML = '<svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg> Copié !';
      setTimeout(() => { btnCopy.innerHTML = original; }, 1500);
    });
  });

  btnNew.addEventListener('click', showForm);
  btnBack.addEventListener('click', showForm);
});
