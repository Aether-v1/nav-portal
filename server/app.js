const path = require('path');
const http = require('http');
const https = require('https');
const { URL } = require('url');
const express = require('express');
const morgan = require('morgan');
const { getConfig, getPublicConfig, ensureLogDir } = require('./config');
const { createLogger } = require('./logger');

const config = getConfig();
ensureLogDir(config.paths.logDir);
const logger = createLogger(config.paths.logDir, {
  maxFileSize: config.logging.maxFileSize,
  maxFiles: config.logging.maxFiles,
  anonymizeIp: config.logging.anonymizeIp
});

const app = express();

// ─── Trust Proxy ───────────────────────────────────────────────
if (config.server.trustProxy) {
  app.set('trust proxy', config.server.trustProxyHopCount);
}

// ─── 安全响应头 ────────────────────────────────────────────────
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self' https://client.crisp.chat https://static.cloudflareinsights.com",
      "style-src 'self' 'unsafe-inline' https://client.crisp.chat",
      "img-src 'self' data: https:",
      "font-src 'self' data:",
      "connect-src 'self' https://client.crisp.chat wss://client.crisp.chat",
      "frame-src https://client.crisp.chat",
      "worker-src 'none'",
      "object-src 'none'",
      "base-uri 'self'"
    ].join('; ')
  );
  next();
});

// ─── API 不缓存 ───────────────────────────────────────────────
app.use('/api/', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

// ─── 禁止访问 logs 目录 ───────────────────────────────────────
app.use('/logs', (req, res) => {
  res.status(404).send('Not Found');
});

// ─── 静态资源 ─────────────────────────────────────────────────
app.use('/css', express.static(path.join(config.paths.webDir, 'css'), {
  maxAge: '7d',
  etag: true
}));
app.use('/js', express.static(path.join(config.paths.webDir, 'js'), {
  maxAge: '7d',
  etag: true
}));
app.use('/images', express.static(path.join(config.paths.webDir, 'images'), {
  maxAge: '30d',
  etag: true
}));
app.use('/assets', express.static(path.join(config.paths.webDir, 'assets'), {
  maxAge: '30d',
  etag: true
}));
app.use('/favicon.ico', express.static(path.join(config.paths.webDir, 'favicon.ico'), {
  maxAge: '30d'
}));
app.use('/logo.png', express.static(path.join(config.paths.webDir, 'logo.png'), {
  maxAge: '30d'
}));

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// ─── 访问日志 ─────────────────────────────────────────────────
if (config.server.enableAccessLog) {
  app.use(
    morgan('combined', {
      stream: {
        write: (message) => {
          logger.access({ raw: message.trim() });
        }
      }
    })
  );
}

// ─── UA 拦截 ──────────────────────────────────────────────────
app.use((req, res, next) => {
  if (!config.server.enableUaBlock) return next();
  const ua = String(req.get('user-agent') || '').toLowerCase();
  const hit = config.server.blockedUaKeywords.find((keyword) => ua.includes(keyword));
  if (!hit) return next();

  if (config.logging.enableRiskLog) {
    logger.risk({
      ip: req.ip,
      path: req.originalUrl,
      ua,
      reason: `blocked ua keyword: ${hit}`
    });
  }

  return res.status(403).json({ success: false, message: 'Forbidden', code: 'FORBIDDEN' });
});

// ─── 轻量级内存限流 ───────────────────────────────────────────
const rateLimitStore = new Map();

function rateLimit(maxRequests, windowMs) {
  return (req, res, next) => {
    if (!config.rateLimit.enabled) return next();

    const ip = req.ip || 'unknown';
    const key = `${ip}:${req.path}`;
    const now = Date.now();
    const entry = rateLimitStore.get(key);

    if (!entry || now - entry.windowStart > windowMs) {
      rateLimitStore.set(key, { windowStart: now, count: 1 });
      return next();
    }

    entry.count += 1;
    if (entry.count > maxRequests) {
      const retryAfter = Math.ceil((windowMs - (now - entry.windowStart)) / 1000);
      res.setHeader('Retry-After', String(retryAfter));
      return res.status(429).json({
        success: false,
        message: '请求过于频繁，请稍后再试',
        code: 'RATE_LIMITED'
      });
    }

    next();
  };
}

setInterval(() => {
  const now = Date.now();
  const maxAge = config.rateLimit.windowMs * 2;
  for (const [key, entry] of rateLimitStore) {
    if (now - entry.windowStart > maxAge) {
      rateLimitStore.delete(key);
    }
  }
}, 60000).unref();

// ─── 工具函数 ─────────────────────────────────────────────────
function getClientIp(req) {
  return req.get('cf-connecting-ip') || req.get('x-real-ip') || req.ip || '';
}

function parseLinkId(raw) {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}

function getEnabledLink(id) {
  const link = config.links[String(id)];
  if (!link || !link.enabled || !link.url) return null;
  if (!isSafeRedirectUrl(link.url)) return null;
  return link;
}

function sendError(res, status, message, code) {
  res.status(status).json({ success: false, message, code });
}

// ─── SSRF 防护 ────────────────────────────────────────────────
const BLOCKED_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '169.254.169.254'
]);

function isPrivateIp(ip) {
  // IPv4
  const v4 = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [, a, b] = v4.map(Number);
    if (a === 10) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 0) return true;
  }
  // IPv6 (without brackets)
  if (ip === '::1') return true;
  if (ip.startsWith('fc') || ip.startsWith('fd')) return true; // fc00::/7
  if (ip.startsWith('fe80')) return true; // fe80::/10
  // IPv4-mapped IPv6: ::ffff:x.x.x.x
  const v4mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (v4mapped) return isPrivateIp(v4mapped[1]);
  // IPv4-mapped IPv6 hex: ::ffff:7f00:1
  const v4mappedHex = ip.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
  if (v4mappedHex) {
    const high = parseInt(v4mappedHex[1], 16);
    const a = high >> 8;
    const b = high & 0xff;
    if (a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || a === 0) return true;
  }
  return false;
}

function isSafeUrl(targetUrl) {
  try {
    const parsed = new URL(targetUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    let hostname = parsed.hostname.toLowerCase();
    // 去掉 IPv6 括号
    if (hostname.startsWith('[') && hostname.endsWith(']')) {
      hostname = hostname.slice(1, -1);
    }
    if (BLOCKED_HOSTS.has(hostname)) return false;
    // IPv4 字面量
    if (/^(\d{1,3}\.){3}\d{1,3}$/.test(hostname)) {
      if (isPrivateIp(hostname)) return false;
    }
    // IPv6 字面量（含冒号）
    if (hostname.includes(':') && isPrivateIp(hostname)) return false;
    return true;
  } catch {
    return false;
  }
}

function isSafeRedirectUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

// ─── 后端测速 ─────────────────────────────────────────────────
const pingCache = new Map();
let pingConcurrent = 0;

function serverPing(targetUrl, timeout) {
  return new Promise((resolve) => {
    const start = Date.now();
    const client = targetUrl.startsWith('https') ? https : http;

    const req = client.get(targetUrl, {
      timeout,
      headers: { 'User-Agent': 'nav-portal-health-check/1.0' }
    }, (res) => {
      res.resume();
      res.on('end', () => {
        resolve({ ok: true, delay: Date.now() - start, status: res.statusCode });
      });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({ ok: false, delay: null, error: 'timeout' });
    });
    req.on('error', (err) => {
      resolve({ ok: false, delay: null, error: err.code || 'network_error' });
    });
  });
}

async function measurePingWithRetry(link, timeout, retries = 2) {
  let lastResult = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const result = await serverPing(link.ping, timeout);
    if (result.ok) return result;
    lastResult = result;
    if (attempt < retries) {
      await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
    }
  }
  return lastResult;
}

// ─── API: 公开配置 ────────────────────────────────────────────
app.get('/api/config', rateLimit(config.rateLimit.maxRequests, config.rateLimit.windowMs), (req, res) => {
  res.json(getPublicConfig(config));
});

// ─── API: 后端测速 ────────────────────────────────────────────
app.get('/api/ping', rateLimit(config.rateLimit.pingMax, config.rateLimit.windowMs), async (req, res) => {
  if (!config.ping.enabled) {
    return sendError(res, 403, '测速功能未启用', 'PING_DISABLED');
  }

  const id = parseLinkId(req.query.id);
  if (!id) {
    return sendError(res, 400, '无效的线路 ID', 'INVALID_ID');
  }

  const link = getEnabledLink(id);
  if (!link) {
    return sendError(res, 404, '线路不存在', 'LINK_NOT_FOUND');
  }

  if (!link.ping) {
    return res.json({ success: true, id, delay: null, status: 'unavailable' });
  }

  if (!isSafeUrl(link.ping)) {
    return sendError(res, 400, '测速地址不安全', 'UNSAFE_TARGET');
  }

  if (pingConcurrent >= config.ping.maxConcurrent) {
    return sendError(res, 429, '测速服务繁忙，请稍后重试', 'PING_BUSY');
  }

  const cacheKey = String(id);
  const cached = pingCache.get(cacheKey);
  if (cached && Date.now() - cached.time < config.ping.cacheTtl) {
    return res.json({ success: true, id, delay: cached.delay, status: cached.delay !== null ? 'ok' : 'timeout', cached: true });
  }

  pingConcurrent += 1;
  try {
    const result = await measurePingWithRetry(link, config.ping.timeout, 2);
    const delay = result.ok ? result.delay : null;
    pingCache.set(cacheKey, { time: Date.now(), delay });
    return res.json({
      success: true,
      id,
      delay,
      status: result.ok ? 'ok' : 'timeout'
    });
  } catch (err) {
    logger.error({ message: 'ping failed', error: err.message, linkId: id });
    return sendError(res, 500, '测速失败', 'PING_ERROR');
  } finally {
    pingConcurrent = Math.max(0, pingConcurrent - 1);
  }
});

// ─── API: Jump Meta ───────────────────────────────────────────
app.get('/api/jump/meta', rateLimit(config.rateLimit.maxRequests, config.rateLimit.windowMs), (req, res) => {
  const id = parseLinkId(req.query.id);
  if (!id) {
    return sendError(res, 400, '无效的线路 ID', 'INVALID_ID');
  }

  const link = getEnabledLink(id);
  if (!link) {
    return sendError(res, 404, '线路不存在', 'LINK_NOT_FOUND');
  }

  if (config.logging.enableJumpLog) {
    logger.jump({
      action: 'meta',
      linkId: link.id,
      linkName: link.name,
      ip: getClientIp(req),
      ua: req.get('user-agent') || ''
    });
  }

  return res.json({
    success: true,
    id: link.id,
    name: link.name,
    badge: link.badge,
    seconds: config.site.jumpSeconds,
    title: config.site.jumpTitle,
    message: config.site.jumpMessage,
    footer: config.site.jumpFooter
  });
});

// ─── API: Jump Resolve ────────────────────────────────────────
app.get('/api/jump/resolve', rateLimit(config.rateLimit.maxRequests, config.rateLimit.windowMs), (req, res) => {
  const id = parseLinkId(req.query.id);
  if (!id) {
    return sendError(res, 400, '无效的线路 ID', 'INVALID_ID');
  }

  const link = getEnabledLink(id);
  if (!link) {
    return sendError(res, 404, '线路不存在', 'LINK_NOT_FOUND');
  }

  if (config.logging.enableJumpLog) {
    logger.jump({
      action: 'resolve',
      linkId: link.id,
      linkName: link.name,
      target: link.url,
      ip: getClientIp(req),
      ua: req.get('user-agent') || '',
      referer: req.get('referer') || ''
    });
  }

  return res.json({ success: true, url: link.url });
});

// ─── 页面路由 ─────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.sendFile(path.join(config.paths.webDir, 'index.html'));
});

app.get('/jump', (req, res) => {
  res.sendFile(path.join(config.paths.webDir, 'jump.html'));
});

// ─── 健康检查 ─────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ ok: true, uptime: process.uptime() });
});

app.head('/health', (req, res) => {
  res.status(200).end();
});

// ─── 404 ──────────────────────────────────────────────────────
app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    return sendError(res, 404, '接口不存在', 'NOT_FOUND');
  }
  res.status(404).send('Not Found');
});

// ─── 全局错误处理 ─────────────────────────────────────────────
app.use((err, req, res, _next) => {
  logger.error({
    message: err.message,
    stack: err.stack,
    path: req.originalUrl,
    ip: getClientIp(req)
  });
  sendError(res, 500, '服务器内部错误', 'INTERNAL_ERROR');
});

// ─── 启动 + Graceful Shutdown ─────────────────────────────────
// 默认监听 127.0.0.1，仅允许本机 Nginx 反代访问，避免外网直连 Node
const server = app.listen(config.server.port, config.server.bindAddress, () => {
  console.log(`nav-portal running on ${config.server.bindAddress}:${config.server.port}`);
});

function shutdown(signal) {
  console.log(`${signal} received, shutting down gracefully...`);
  server.close(() => {
    console.log('HTTP server closed.');
    process.exit(0);
  });
  setTimeout(() => {
    console.error('Forced shutdown after timeout.');
    process.exit(1);
  }, 10000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

module.exports = app;
