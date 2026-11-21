'use strict';

(function () {
  const API = 'https://ops.realitymanual.com/api/customer-submissions';
  const MAX_VIDEO = 3 * 1024 * 1024 * 1024;
  const MAX_IMAGE = 20 * 1024 * 1024;
  const allowedVideo = new Set(['video/mp4', 'video/quicktime', 'video/webm', 'video/x-m4v']);
  const allowedImage = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic']);
  const sizeLabel = bytes => bytes >= 1024 * 1024 * 1024 ? (bytes / 1024 ** 3).toFixed(2) + ' GB' : (bytes / 1024 ** 2).toFixed(1) + ' MB';

  async function api(path, body) {
    const response = await fetch(API + path, { method: 'POST', mode: 'cors', credentials: 'omit',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.message || 'We could not save this right now. Please try again.');
    return result;
  }

  async function videoDuration(file) {
    const url = URL.createObjectURL(file);
    try {
      return await new Promise((resolve, reject) => {
        const video = document.createElement('video');
        const timeout = setTimeout(() => reject(new Error('Could not read the video length. Please use MP4, MOV or WebM.')), 15000);
        video.preload = 'metadata'; video.src = url;
        video.onloadedmetadata = () => { clearTimeout(timeout); resolve(video.duration); };
        video.onerror = () => { clearTimeout(timeout); reject(new Error('Could not read the video length. Please use MP4, MOV or WebM.')); };
      });
    } finally { URL.revokeObjectURL(url); }
  }

  function setup(form) {
    const picker = form.querySelector('[data-media-picker]');
    const status = form.querySelector('.form-status');
    const button = form.querySelector('button[type=submit]');
    const kind = form.dataset.kind;
    const files = [];
    const urls = new Map();
    let pending = null;
    picker.innerHTML = '<div class="media-heading"><strong>Add a little more of your story</strong><span>Optional · Up to three files; one video max (3 GB), images up to 20 MB</span></div>' +
      '<div class="media-tiles"><label class="media-tile"><span class="tile-icon" aria-hidden="true">▣</span><strong>Share a video</strong><small>Your voice, your book, your story</small><input type="file" accept="video/mp4,video/quicktime,video/webm,.m4v" data-video></label>' +
      '<label class="media-tile"><span class="tile-icon" aria-hidden="true">▧</span><strong>Add a photo</strong><small>A page, a moment, or you and the book</small><input type="file" accept="image/jpeg,image/png,image/webp,image/heic" multiple data-image></label></div><div class="selected-files" aria-live="polite"></div>';
    const list = picker.querySelector('.selected-files');
    function setStatus(text, error) { status.textContent = text; status.classList.toggle('error', !!error); }
    function renderFiles() {
      urls.forEach(url => URL.revokeObjectURL(url)); urls.clear(); list.replaceChildren();
      files.forEach((file, index) => {
        const row = document.createElement('div'); row.className = 'selected-file';
        const kind = file.type.startsWith('video/') ? 'Video' : 'Image';
        let preview;
        if (file.type !== 'image/heic') {
          const url = URL.createObjectURL(file); urls.set(index, url);
          preview = document.createElement(kind === 'Video' ? 'video' : 'img');
          preview.src = url; preview.muted = true; preview.setAttribute('aria-hidden', 'true');
        } else { preview = document.createElement('span'); preview.className = 'file-glyph'; preview.textContent = '▧'; }
        const info = document.createElement('span');
        const title = document.createElement('strong'); title.textContent = file.name;
        const detail = document.createElement('small'); detail.textContent = kind + ' · ' + sizeLabel(file.size);
        info.append(title, detail);
        const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = 'Remove';
        remove.setAttribute('aria-label', 'Remove ' + file.name);
        remove.addEventListener('click', () => { files.splice(index, 1); renderFiles(); });
        row.append(preview, info, remove); list.append(row);
      });
    }
    function addFiles(incoming) {
      for (const file of Array.from(incoming)) {
        const video = allowedVideo.has(file.type);
        const image = allowedImage.has(file.type);
        if ((!video && !image) || file.size <= 0 || file.size > (video ? MAX_VIDEO : MAX_IMAGE)) {
          setStatus('Please use MP4, MOV, WebM, JPG, PNG, WebP or HEIC. Videos must be under 3 GB; images under 20 MB.', true); return;
        }
        if (files.length >= 3 || (video && files.some(item => allowedVideo.has(item.type)))) {
          setStatus('Please choose at most three files, including no more than one video.', true); return;
        }
        files.push(file);
      }
      setStatus('', false); renderFiles();
    }
    picker.querySelector('[data-video]').addEventListener('change', event => { addFiles(event.target.files); event.target.value = ''; });
    picker.querySelector('[data-image]').addEventListener('change', event => { addFiles(event.target.files); event.target.value = ''; });

    async function sendPart(submission, fileInfo, file, partNumber, completed) {
      const start = (partNumber - 1) * submission.partBytes;
      const end = Math.min(file.size, start + submission.partBytes);
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const signed = await api('/' + submission.id + '/part', { token: submission.token, fileId: fileInfo.id, partNumber });
          const response = await fetch(signed.url, { method: 'PUT', body: file.slice(start, end), mode: 'cors' });
          const etag = response.headers.get('ETag');
          if (!response.ok || !etag) throw new Error('The file upload was interrupted. Please try again.');
          completed.bytes += end - start;
          setStatus('Uploading securely to storage · ' + Math.round(completed.bytes / completed.total * 100) + '%', false);
          return { partNumber, etag };
        } catch (error) {
          if (attempt === 2) throw error;
          await new Promise(resolve => setTimeout(resolve, 600 * (attempt + 1)));
        }
      }
    }
    async function sendFile(submission, info, file, completed) {
      const count = Math.ceil(file.size / submission.partBytes);
      const parts = new Array(count);
      let next = 1;
      async function worker() {
        while (next <= count) {
          const number = next++;
          parts[number - 1] = await sendPart(submission, info, file, number, completed);
        }
      }
      await Promise.all(Array.from({ length: Math.min(3, count) }, worker));
      return { id: info.id, parts };
    }
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (button.disabled) return;
      if (!form.reportValidity()) return;
      const message = form.elements.message.value.trim();
      if (message.length < 5) { setStatus('Please write at least a few words.', true); form.elements.message.focus(); return; }
      const paidVideo = kind === 'review' && form.elements.paidVideo.checked;
      const video = files.find(file => allowedVideo.has(file.type));
      if (paidVideo && !video) { setStatus('Add a video to request the $50 payment.', true); return; }
      button.disabled = true;
      try {
        if (paidVideo) {
          const duration = await videoDuration(video);
          if (!Number.isFinite(duration) || duration < 30) throw new Error('For the $50 payment, your video must be at least 30 seconds long.');
        }
        setStatus('Preparing your private submission…', false);
        const details = { kind, name: form.elements.name.value.trim(),
          email: form.elements.email.value.trim(), message, paidVideo,
          consent: kind === 'review' ? form.elements.consent.checked : false,
          website: form.elements.website.value,
          files: files.map(file => ({ name: file.name, type: file.type, size: file.size })) };
        const key = JSON.stringify(details);
        if (!pending || pending.key !== key || pending.files.length !== files.length || pending.files.some((file, index) => file !== files[index])) {
          pending = { key, files: files.slice(), submission: await api('/start', details) };
        }
        const submission = pending.submission;
        const completed = { bytes: 0, total: files.reduce((sum, file) => sum + file.size, 0) };
        const uploaded = [];
        for (let index = 0; index < files.length; index++) uploaded.push(await sendFile(submission, submission.files[index], files[index], completed));
        setStatus('Finishing and verifying your submission…', false);
        await api('/' + submission.id + '/complete', { token: submission.token, files: uploaded });
        pending = null; form.reset(); files.length = 0; renderFiles();
        setStatus('Thank you. Your ' + kind + ' is safely in Harvey’s hands.', false);
      } catch (error) { setStatus(error.message || 'Something went wrong. Please try again.', true); }
      finally { button.disabled = false; }
    });
  }
  document.querySelectorAll('form[data-kind]').forEach(setup);
})();
