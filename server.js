const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');

const HOST = '0.0.0.0';
const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const DATA_DIR = path.join(__dirname, 'data');
const PHOTOS_FILE = path.join(DATA_DIR, 'photos.json');
const VOTES_FILE = path.join(DATA_DIR, 'votes.json');
const ALLOWED_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/gif',
  'image/bmp',
  'image/svg+xml',
  'image/heic',
  'image/heif',
  'image/avif'
]);
const STATIC_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml'
};

ensureStorage();

function ensureStorage() {
  for (const dir of [PUBLIC_DIR, UPLOADS_DIR, DATA_DIR]) {
    fs.mkdirSync(dir, { recursive: true });
  }
  if (!fs.existsSync(PHOTOS_FILE)) {
    fs.writeFileSync(PHOTOS_FILE, '[]\n');
  }
  if (!fs.existsSync(VOTES_FILE)) {
    fs.writeFileSync(VOTES_FILE, '{}\n');
  }
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    return fallback;
  }
}

function writeJson(file, value) {
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(payload));
}

function sendFile(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const contentType = STATIC_TYPES[ext] || 'application/octet-stream';
  const stream = fs.createReadStream(filePath);
  stream.on('error', () => {
    sendJson(res, 404, { error: '文件不存在。' });
  });
  res.writeHead(200, { 'Content-Type': contentType });
  stream.pipe(res);
}

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim();
  }
  return req.socket.remoteAddress || 'unknown';
}

function hashIp(ip) {
  return crypto.createHash('sha256').update(ip).digest('hex');
}

function sanitizeText(value, maxLength) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, maxLength);
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 15 * 1024 * 1024) {
        reject(new Error('请求体过大。'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(new Error('无效的 JSON 请求。'));
      }
    });
    req.on('error', reject);
  });
}

function getPhotos() {
  const photos = readJson(PHOTOS_FILE, []);
  return photos
    .slice()
    .sort((a, b) => b.likes - a.likes || new Date(b.createdAt) - new Date(a.createdAt));
}

function publicPhoto(photo) {
  return {
    id: photo.id,
    title: photo.title,
    author: photo.author,
    description: photo.description,
    scenario: photo.scenario,
    contact: photo.contact,
    imageUrl: photo.imageUrl,
    likes: photo.likes,
    createdAt: photo.createdAt,
    imageType: photo.imageType
  };
}

function handleGetPhotos(res) {
  const photos = getPhotos().map(publicPhoto);
  sendJson(res, 200, { photos, refreshedAt: new Date().toISOString() });
}

function saveImage(dataUrl) {
  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(dataUrl || '');
  if (!match) {
    throw new Error('图片格式无效，请重新上传。');
  }
  const mimeType = match[1].toLowerCase();
  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    throw new Error('仅支持 PNG、JPG、WebP、GIF、BMP、SVG、HEIC、AVIF 等主流图片格式。');
  }
  const ext = mimeType === 'image/jpeg' || mimeType === 'image/jpg'
    ? '.jpg'
    : mimeType === 'image/svg+xml'
      ? '.svg'
      : '.' + mimeType.split('/')[1].replace('xml+', '');
  const fileName = `${Date.now()}-${crypto.randomUUID()}${ext}`;
  const filePath = path.join(UPLOADS_DIR, fileName);
  fs.writeFileSync(filePath, Buffer.from(match[2], 'base64'));
  return { imageUrl: `/uploads/${fileName}`, imageType: mimeType };
}

async function handleCreatePhoto(req, res) {
  try {
    const body = await parseBody(req);
    const title = sanitizeText(body.title, 80);
    const author = sanitizeText(body.author, 40);
    const description = sanitizeText(body.description, 160);
    const scenario = sanitizeText(body.scenario, 60);
    const contact = sanitizeText(body.contact, 80);
    const imageData = body.imageData;

    if (!title || !author || !description || !scenario || !contact || !imageData) {
      return sendJson(res, 400, { error: '请完整填写作品信息并上传图片。' });
    }

    const image = saveImage(imageData);
    const photos = readJson(PHOTOS_FILE, []);
    const record = {
      id: crypto.randomUUID(),
      title,
      author,
      description,
      scenario,
      contact,
      imageUrl: image.imageUrl,
      imageType: image.imageType,
      likes: 0,
      createdAt: new Date().toISOString()
    };
    photos.push(record);
    writeJson(PHOTOS_FILE, photos);
    sendJson(res, 201, { photo: publicPhoto(record), message: '图片作品上传成功。' });
  } catch (error) {
    sendJson(res, 400, { error: error.message || '上传失败，请稍后再试。' });
  }
}

function canVoteToday(voteRecord, today, photoId) {
  if (!voteRecord || voteRecord.date !== today) {
    return true;
  }
  return voteRecord.photoId === photoId;
}

async function handleVote(req, res, photoId) {
  try {
    const photos = readJson(PHOTOS_FILE, []);
    const index = photos.findIndex((photo) => photo.id === photoId);
    if (index === -1) {
      return sendJson(res, 404, { error: '作品不存在。' });
    }

    const ipHash = hashIp(getClientIp(req));
    const today = new Date().toISOString().slice(0, 10);
    const votes = readJson(VOTES_FILE, {});
    const voteRecord = votes[ipHash];

    if (!canVoteToday(voteRecord, today, photoId)) {
      return sendJson(res, 429, { error: '同一个 IP 每天只能给一张作品点赞。' });
    }

    if (!voteRecord || voteRecord.date !== today) {
      photos[index].likes += 1;
      votes[ipHash] = { date: today, photoId };
      writeJson(PHOTOS_FILE, photos);
      writeJson(VOTES_FILE, votes);
    }

    sendJson(res, 200, {
      message: '点赞成功。',
      photo: publicPhoto(photos[index]),
      refreshedAt: new Date().toISOString()
    });
  } catch (error) {
    sendJson(res, 500, { error: '点赞失败，请稍后再试。' });
  }
}

function serveStatic(req, res, pathname) {
  const safePath = path.normalize(path.join(__dirname, pathname));
  if (!safePath.startsWith(__dirname)) {
    return sendJson(res, 403, { error: '禁止访问。' });
  }
  if (!fs.existsSync(safePath) || fs.statSync(safePath).isDirectory()) {
    return sendJson(res, 404, { error: '页面不存在。' });
  }
  sendFile(res, safePath);
}

const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
  const pathname = parsedUrl.pathname;

  if (req.method === 'GET' && pathname === '/api/photos') {
    return handleGetPhotos(res);
  }

  if (req.method === 'POST' && pathname === '/api/photos') {
    return handleCreatePhoto(req, res);
  }

  if (req.method === 'POST' && pathname.startsWith('/api/photos/') && pathname.endsWith('/vote')) {
    const photoId = pathname.split('/')[3];
    return handleVote(req, res, photoId);
  }

  if (req.method === 'GET' && pathname.startsWith('/uploads/')) {
    return serveStatic(req, res, pathname);
  }

  if (req.method === 'GET' && (pathname === '/' || pathname.startsWith('/public/'))) {
    const target = pathname === '/' ? '/public/index.html' : pathname;
    return serveStatic(req, res, target);
  }

  sendJson(res, 404, { error: '未找到请求资源。' });
});

server.listen(PORT, HOST, () => {
  console.log(`Photo share app listening on http://${HOST}:${PORT}`);
});
