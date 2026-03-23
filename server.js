const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const net = require('net');
const tls = require('tls');
const { URL } = require('url');

const HOST = '0.0.0.0';
const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, 'public');
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const DATA_DIR = path.join(__dirname, 'data');
const PHOTOS_FILE = path.join(DATA_DIR, 'photos.json');
const PENDING_FILE = path.join(DATA_DIR, 'pending-submissions.json');
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
const MAIL_CONFIG = {
  host: process.env.SMTP_HOST || 'smtp.qq.com',
  port: Number(process.env.SMTP_PORT || 465),
  secure: String(process.env.SMTP_SECURE || 'true') !== 'false',
  user: process.env.SMTP_USER || '',
  pass: process.env.SMTP_PASS || '',
  from: process.env.MAIL_FROM || process.env.SMTP_USER || '',
  to: process.env.MAIL_TO || '1113563895@qq.com',
  publicBaseUrl: process.env.PUBLIC_BASE_URL || `http://127.0.0.1:${PORT}`
};

ensureStorage();

function ensureStorage() {
  for (const dir of [PUBLIC_DIR, UPLOADS_DIR, DATA_DIR]) {
    fs.mkdirSync(dir, { recursive: true });
  }
  if (!fs.existsSync(PHOTOS_FILE)) fs.writeFileSync(PHOTOS_FILE, '[]\n');
  if (!fs.existsSync(PENDING_FILE)) fs.writeFileSync(PENDING_FILE, '[]\n');
  if (!fs.existsSync(VOTES_FILE)) fs.writeFileSync(VOTES_FILE, '{}\n');
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

function sendHtml(res, statusCode, html) {
  res.writeHead(statusCode, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(html);
}

function sendFile(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const contentType = STATIC_TYPES[ext] || 'application/octet-stream';
  const stream = fs.createReadStream(filePath);
  stream.on('error', () => sendJson(res, 404, { error: '文件不存在。' }));
  res.writeHead(200, { 'Content-Type': contentType });
  stream.pipe(res);
}

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
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
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      chunks.push(chunk);
      size += chunk.length;
      if (size > 18 * 1024 * 1024) {
        reject(new Error('请求体过大。'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(new Error('无效的 JSON 请求。'));
      }
    });
    req.on('error', reject);
  });
}

function getApprovedPhotos() {
  return readJson(PHOTOS_FILE, [])
    .slice()
    .sort((a, b) => b.likes - a.likes || new Date(b.approvedAt || b.createdAt) - new Date(a.approvedAt || a.createdAt));
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
    imageType: photo.imageType,
    likes: photo.likes,
    createdAt: photo.createdAt,
    approvedAt: photo.approvedAt || null
  };
}

function handleGetPhotos(res) {
  sendJson(res, 200, {
    photos: getApprovedPhotos().map(publicPhoto),
    refreshedAt: new Date().toISOString()
  });
}

function saveImage(dataUrl) {
  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(dataUrl || '');
  if (!match) throw new Error('图片格式无效，请重新上传。');

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

function createModerationToken() {
  return crypto.randomBytes(24).toString('hex');
}

function renderModerationEmail(submission) {
  const approveUrl = `${MAIL_CONFIG.publicBaseUrl}/moderation?action=approve&token=${submission.moderationToken}`;
  const rejectUrl = `${MAIL_CONFIG.publicBaseUrl}/moderation?action=reject&token=${submission.moderationToken}`;
  const safeTitle = escapeHtml(submission.title);
  const safeAuthor = escapeHtml(submission.author);
  const safeDescription = escapeHtml(submission.description);
  const safeScenario = escapeHtml(submission.scenario);
  const safeContact = escapeHtml(submission.contact);
  const safeImage = escapeHtml(`${MAIL_CONFIG.publicBaseUrl}${submission.imageUrl}`);

  return {
    subject: `【待审核】新的照片投稿：${submission.title}`,
    html: `
      <div style="font-family:Arial,sans-serif;line-height:1.7;color:#162033;max-width:720px;margin:auto;">
        <h2>收到新的照片投稿，等待审核</h2>
        <p>下面是用户提交的全部信息：</p>
        <ul>
          <li><strong>作品名称：</strong>${safeTitle}</li>
          <li><strong>作者：</strong>${safeAuthor}</li>
          <li><strong>一句话描述：</strong>${safeDescription}</li>
          <li><strong>应用场景：</strong>${safeScenario}</li>
          <li><strong>联系方式：</strong>${safeContact}</li>
          <li><strong>提交时间：</strong>${escapeHtml(submission.createdAt)}</li>
        </ul>
        <p><img src="${safeImage}" alt="投稿图片" style="max-width:100%;border-radius:16px;box-shadow:0 8px 30px rgba(0,0,0,.15);" /></p>
        <p>
          <a href="${approveUrl}" style="display:inline-block;padding:12px 20px;border-radius:999px;background:#16a34a;color:#fff;text-decoration:none;margin-right:12px;">审核通过</a>
          <a href="${rejectUrl}" style="display:inline-block;padding:12px 20px;border-radius:999px;background:#dc2626;color:#fff;text-decoration:none;">审核不通过</a>
        </p>
        <p>如果按钮无法点击，也可以直接复制以下链接：</p>
        <p>通过：<br />${escapeHtml(approveUrl)}</p>
        <p>拒绝：<br />${escapeHtml(rejectUrl)}</p>
      </div>
    `
  };
}

function createMimeMessage({ from, to, subject, html }) {
  const encodedSubject = `=?UTF-8?B?${Buffer.from(subject, 'utf8').toString('base64')}?=`;
  return [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${encodedSubject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(html, 'utf8').toString('base64')
  ].join('\r\n');
}

function readSmtpResponse(socket) {
  return new Promise((resolve, reject) => {
    let buffer = '';
    const onData = (chunk) => {
      buffer += chunk.toString('utf8');
      const lines = buffer.split(/\r?\n/).filter(Boolean);
      if (!lines.length) return;
      const lastLine = lines[lines.length - 1];
      if (/^\d{3} /.test(lastLine)) {
        cleanup();
        resolve(buffer);
      }
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      socket.off('data', onData);
      socket.off('error', onError);
    };
    socket.on('data', onData);
    socket.on('error', onError);
  });
}

async function sendSmtpCommand(socket, command, expectedCodes) {
  if (command) socket.write(`${command}\r\n`);
  const response = await readSmtpResponse(socket);
  const ok = expectedCodes.some((code) => response.startsWith(String(code)) || response.split(/\r?\n/).some((line) => line.startsWith(String(code))));
  if (!ok) {
    throw new Error(`SMTP 命令失败：${command || 'GREETING'} => ${response.trim()}`);
  }
  return response;
}

async function sendModerationEmail(submission) {
  if (!MAIL_CONFIG.user || !MAIL_CONFIG.pass || !MAIL_CONFIG.from || !MAIL_CONFIG.to) {
    return { skipped: true, reason: '未配置 SMTP_USER / SMTP_PASS / MAIL_FROM / MAIL_TO，已跳过邮件发送。' };
  }

  const email = renderModerationEmail(submission);
  const message = createMimeMessage({
    from: MAIL_CONFIG.from,
    to: MAIL_CONFIG.to,
    subject: email.subject,
    html: email.html
  });

  const socket = MAIL_CONFIG.secure
    ? tls.connect(MAIL_CONFIG.port, MAIL_CONFIG.host, { servername: MAIL_CONFIG.host })
    : net.createConnection(MAIL_CONFIG.port, MAIL_CONFIG.host);

  await new Promise((resolve, reject) => {
    socket.once('secureConnect', resolve);
    socket.once('connect', resolve);
    socket.once('error', reject);
  });

  try {
    await sendSmtpCommand(socket, '', [220]);
    await sendSmtpCommand(socket, `EHLO ${MAIL_CONFIG.host}`, [250]);
    await sendSmtpCommand(socket, 'AUTH LOGIN', [334]);
    await sendSmtpCommand(socket, Buffer.from(MAIL_CONFIG.user, 'utf8').toString('base64'), [334]);
    await sendSmtpCommand(socket, Buffer.from(MAIL_CONFIG.pass, 'utf8').toString('base64'), [235]);
    await sendSmtpCommand(socket, `MAIL FROM:<${MAIL_CONFIG.from}>`, [250]);
    await sendSmtpCommand(socket, `RCPT TO:<${MAIL_CONFIG.to}>`, [250, 251]);
    await sendSmtpCommand(socket, 'DATA', [354]);
    socket.write(`${message}\r\n.\r\n`);
    await sendSmtpCommand(socket, '', [250]);
    await sendSmtpCommand(socket, 'QUIT', [221]);
    socket.end();
    return { skipped: false };
  } catch (error) {
    socket.destroy();
    throw error;
  }
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
    const pending = readJson(PENDING_FILE, []);
    const submission = {
      id: crypto.randomUUID(),
      moderationToken: createModerationToken(),
      title,
      author,
      description,
      scenario,
      contact,
      imageUrl: image.imageUrl,
      imageType: image.imageType,
      likes: 0,
      status: 'pending',
      createdAt: new Date().toISOString(),
      reviewedAt: null,
      reviewAction: null
    };
    pending.push(submission);
    writeJson(PENDING_FILE, pending);

    let mailResult;
    try {
      mailResult = await sendModerationEmail(submission);
    } catch (mailError) {
      mailResult = { skipped: true, reason: `邮件发送失败：${mailError.message}` };
    }

    sendJson(res, 201, {
      message: '投稿已提交，当前状态为“待审核”。审核通过后才会展示在页面上。',
      submissionId: submission.id,
      mailStatus: mailResult
    });
  } catch (error) {
    sendJson(res, 400, { error: error.message || '上传失败，请稍后再试。' });
  }
}

function canVoteToday(voteRecord, today, photoId) {
  if (!voteRecord || voteRecord.date !== today) return true;
  return voteRecord.photoId === photoId;
}

async function handleVote(req, res, photoId) {
  try {
    const photos = readJson(PHOTOS_FILE, []);
    const index = photos.findIndex((photo) => photo.id === photoId);
    if (index === -1) return sendJson(res, 404, { error: '作品不存在或尚未审核通过。' });

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

function renderModerationResultPage(status, message) {
  return `<!DOCTYPE html>
  <html lang="zh-CN">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>审核结果</title>
      <style>
        body{font-family:Arial,sans-serif;background:#f4f7fb;margin:0;display:grid;place-items:center;min-height:100vh;color:#162033}
        .card{width:min(92vw,640px);background:#fff;border-radius:24px;padding:32px;box-shadow:0 20px 50px rgba(0,0,0,.12)}
        .badge{display:inline-block;padding:8px 14px;border-radius:999px;font-weight:700;margin-bottom:16px;background:${status === 'success' ? '#dcfce7' : '#fee2e2'};color:${status === 'success' ? '#166534' : '#991b1b'}}
        a{color:#4f46e5}
      </style>
    </head>
    <body>
      <div class="card">
        <div class="badge">${status === 'success' ? '操作成功' : '操作失败'}</div>
        <h1>审核处理完成</h1>
        <p>${escapeHtml(message)}</p>
        <p>你现在可以返回网站首页刷新作品列表查看结果。</p>
        <p><a href="/">返回首页</a></p>
      </div>
    </body>
  </html>`;
}

function handleModerationAction(res, query) {
  const action = query.get('action');
  const token = query.get('token');
  if (!action || !token || !['approve', 'reject'].includes(action)) {
    return sendHtml(res, 400, renderModerationResultPage('error', '审核链接无效。'));
  }

  const pending = readJson(PENDING_FILE, []);
  const index = pending.findIndex((item) => item.moderationToken === token);
  if (index === -1) {
    return sendHtml(res, 404, renderModerationResultPage('error', '未找到对应的待审核投稿。'));
  }

  const submission = pending[index];
  if (submission.status !== 'pending') {
    const text = submission.status === 'approved' ? '这个投稿已经审核通过，不需要重复点击。' : '这个投稿已经被拒绝，不需要重复点击。';
    return sendHtml(res, 200, renderModerationResultPage('success', text));
  }

  submission.status = action === 'approve' ? 'approved' : 'rejected';
  submission.reviewAction = action;
  submission.reviewedAt = new Date().toISOString();
  pending[index] = submission;
  writeJson(PENDING_FILE, pending);

  if (action === 'approve') {
    const photos = readJson(PHOTOS_FILE, []);
    photos.push({
      id: submission.id,
      title: submission.title,
      author: submission.author,
      description: submission.description,
      scenario: submission.scenario,
      contact: submission.contact,
      imageUrl: submission.imageUrl,
      imageType: submission.imageType,
      likes: submission.likes || 0,
      createdAt: submission.createdAt,
      approvedAt: submission.reviewedAt
    });
    writeJson(PHOTOS_FILE, photos);
    return sendHtml(res, 200, renderModerationResultPage('success', '审核通过成功，该图片已经进入网站展示列表。'));
  }

  return sendHtml(res, 200, renderModerationResultPage('success', '已拒绝该投稿，这张图片不会展示在网站中。'));
}

function handleGetConfig(res) {
  sendJson(res, 200, {
    moderationEmail: MAIL_CONFIG.to,
    publicBaseUrl: MAIL_CONFIG.publicBaseUrl,
    smtpReady: Boolean(MAIL_CONFIG.user && MAIL_CONFIG.pass && MAIL_CONFIG.from && MAIL_CONFIG.to)
  });
}

function serveStatic(res, pathname) {
  const safePath = path.normalize(path.join(__dirname, pathname));
  if (!safePath.startsWith(__dirname)) return sendJson(res, 403, { error: '禁止访问。' });
  if (!fs.existsSync(safePath) || fs.statSync(safePath).isDirectory()) return sendJson(res, 404, { error: '页面不存在。' });
  sendFile(res, safePath);
}

const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
  const pathname = parsedUrl.pathname;

  if (req.method === 'GET' && pathname === '/api/photos') return handleGetPhotos(res);
  if (req.method === 'GET' && pathname === '/api/config') return handleGetConfig(res);
  if (req.method === 'POST' && pathname === '/api/photos') return handleCreatePhoto(req, res);
  if (req.method === 'POST' && pathname.startsWith('/api/photos/') && pathname.endsWith('/vote')) {
    return handleVote(req, res, pathname.split('/')[3]);
  }
  if (req.method === 'GET' && pathname === '/moderation') return handleModerationAction(res, parsedUrl.searchParams);
  if (req.method === 'GET' && pathname.startsWith('/uploads/')) return serveStatic(res, pathname);
  if (req.method === 'GET' && (pathname === '/' || pathname === '/upload' || pathname === '/gallery' || pathname.startsWith('/public/'))) {
    if (pathname === '/' || pathname === '/upload') return serveStatic(res, '/public/upload.html');
    if (pathname === '/gallery') return serveStatic(res, '/public/gallery.html');
    return serveStatic(res, pathname);
  }

  sendJson(res, 404, { error: '未找到请求资源。' });
});

server.listen(PORT, HOST, () => {
  console.log('----------------------------------------');
  console.log(`照片投稿网站已启动: http://127.0.0.1:${PORT}`);
  console.log(`局域网访问地址: http://localhost:${PORT}`);
  console.log(`审核通知邮箱: ${MAIL_CONFIG.to}`);
  console.log(`邮件审核链接基地址: ${MAIL_CONFIG.publicBaseUrl}`);
  console.log('如果浏览器没反应，请确认你已经访问上面的地址，而不是只执行了命令。');
  console.log('----------------------------------------');
});
