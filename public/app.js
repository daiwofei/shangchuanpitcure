const state = {
  imageData: '',
  photos: []
};

const elements = {
  form: document.getElementById('photoForm'),
  imageInput: document.getElementById('imageInput'),
  previewImage: document.getElementById('previewImage'),
  uploadTitle: document.getElementById('uploadTitle'),
  uploadHint: document.getElementById('uploadHint'),
  formStatus: document.getElementById('formStatus'),
  galleryGrid: document.getElementById('galleryGrid'),
  refreshNote: document.getElementById('refreshNote'),
  template: document.getElementById('photoCardTemplate'),
  mailConfigNote: document.getElementById('mailConfigNote')
};

function setStatus(message, isError = false) {
  elements.formStatus.textContent = message;
  elements.formStatus.style.color = isError ? '#b42318' : '#64718a';
}

function formatRefreshTime(isoString) {
  const time = new Date(isoString);
  return `榜单最近刷新：${time.toLocaleTimeString('zh-CN', { hour12: false })}（每 60 秒自动更新）`;
}

function toDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('图片读取失败，请重试。'));
    reader.readAsDataURL(file);
  });
}

async function loadConfig() {
  try {
    const response = await fetch('/api/config');
    const result = await response.json();
    if (result.smtpReady) {
      elements.mailConfigNote.textContent = `管理员邮箱：${result.moderationEmail}。投稿后将自动发送审核邮件。`;
    } else {
      elements.mailConfigNote.textContent = `当前还没有配置 SMTP 邮件参数，所以投稿只会进入待审核数据文件，不会真正发邮件到 ${result.moderationEmail}。请按 README 配置后再试。`;
    }
  } catch (error) {
    elements.mailConfigNote.textContent = '邮箱配置读取失败，请刷新页面后重试。';
  }
}

async function handleFileSelect(event) {
  const [file] = event.target.files;
  if (!file) return;
  if (!file.type.startsWith('image/')) {
    setStatus('请上传图片格式文件。', true);
    return;
  }

  state.imageData = await toDataUrl(file);
  elements.previewImage.src = state.imageData;
  elements.previewImage.hidden = false;
  elements.uploadTitle.textContent = file.name;
  elements.uploadHint.textContent = '图片预览成功，可以继续填写右侧作品信息。';
  setStatus('图片已选择，补充完整信息后即可提交审核。');
}

function createPhotoCard(photo, index) {
  const fragment = elements.template.content.cloneNode(true);
  const card = fragment.querySelector('.photo-card');
  const image = fragment.querySelector('.card-image');
  const rank = fragment.querySelector('.card-rank');
  const title = fragment.querySelector('.card-title');
  const author = fragment.querySelector('.card-author');
  const description = fragment.querySelector('.card-description');
  const scenario = fragment.querySelector('.scenario');
  const contact = fragment.querySelector('.contact');
  const approvedAt = fragment.querySelector('.approved-at');
  const likesValue = fragment.querySelector('.likes-value');
  const likeBtn = fragment.querySelector('.like-btn');
  const feedback = fragment.querySelector('.vote-feedback');

  rank.textContent = `#${index + 1}`;
  image.src = photo.imageUrl;
  title.textContent = photo.title;
  author.textContent = `作者：${photo.author}`;
  description.textContent = photo.description;
  scenario.textContent = photo.scenario;
  contact.textContent = photo.contact;
  approvedAt.textContent = photo.approvedAt ? new Date(photo.approvedAt).toLocaleString('zh-CN') : '待审核';
  likesValue.textContent = photo.likes;
  feedback.textContent = `上传于 ${new Date(photo.createdAt).toLocaleDateString('zh-CN')}`;

  likeBtn.addEventListener('click', async () => {
    likeBtn.disabled = true;
    try {
      const response = await fetch(`/api/photos/${photo.id}/vote`, { method: 'POST' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || '点赞失败');
      likeBtn.classList.add('liked');
      feedback.textContent = '点赞成功，感谢支持！';
      await loadPhotos();
      window.setTimeout(() => likeBtn.classList.remove('liked'), 600);
    } catch (error) {
      feedback.textContent = error.message;
      likeBtn.disabled = false;
    }
  });

  return card;
}

function renderPhotos() {
  elements.galleryGrid.innerHTML = '';
  if (!state.photos.length) {
    elements.galleryGrid.innerHTML = '<div class="photo-card card-body"><h3>还没有公开作品</h3><p class="card-description">先提交作品并在邮箱里审核通过，榜单才会显示内容。</p></div>';
    return;
  }

  state.photos.forEach((photo, index) => {
    elements.galleryGrid.appendChild(createPhotoCard(photo, index));
  });
}

async function loadPhotos() {
  const response = await fetch('/api/photos');
  const result = await response.json();
  state.photos = result.photos || [];
  renderPhotos();
  elements.refreshNote.textContent = formatRefreshTime(result.refreshedAt || new Date().toISOString());
}

async function handleSubmit(event) {
  event.preventDefault();
  const formData = new FormData(elements.form);
  if (!state.imageData) {
    setStatus('请先上传一张图片。', true);
    return;
  }

  const payload = {
    title: formData.get('title'),
    author: formData.get('author'),
    description: formData.get('description'),
    scenario: formData.get('scenario'),
    contact: formData.get('contact'),
    imageData: state.imageData
  };

  setStatus('正在提交审核，请稍候…');
  const response = await fetch('/api/photos', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const result = await response.json();
  if (!response.ok) {
    setStatus(result.error || '提交失败，请稍后重试。', true);
    return;
  }

  elements.form.reset();
  state.imageData = '';
  elements.previewImage.hidden = true;
  elements.previewImage.removeAttribute('src');
  elements.uploadTitle.textContent = '点击上传图片';
  elements.uploadHint.textContent = '支持 PNG、JPG、WebP、GIF、BMP、SVG、HEIC、AVIF 等格式';

  if (result.mailStatus?.skipped) {
    setStatus(`${result.message} 但目前邮件尚未成功发送：${result.mailStatus.reason}`, true);
  } else {
    setStatus(result.message || '提交成功。');
  }

  await loadPhotos();
  await loadConfig();
}

elements.imageInput.addEventListener('change', (event) => {
  handleFileSelect(event).catch((error) => setStatus(error.message, true));
});

elements.form.addEventListener('submit', (event) => {
  handleSubmit(event).catch((error) => setStatus(error.message, true));
});

Promise.all([loadConfig(), loadPhotos()]).catch(() => {
  elements.refreshNote.textContent = '页面初始化失败，请刷新重试。';
});

window.setInterval(() => {
  loadPhotos().catch(() => {
    elements.refreshNote.textContent = '自动刷新失败，请手动刷新。';
  });
}, 60 * 1000);
