const path = require('path');
const express = require('express');
const morgan = require('morgan');
const { getConfig, ensureLogDir } = require('./config');
const { createLogger } = require('./logger');

const config = getConfig();
ensureLogDir(config.paths.logDir);
const logger = createLogger(config.paths.logDir);
const app = express();

if (config.server.trustProxy) {
  app.set('trust proxy', true);
}

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

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

app.use((req, res, next) => {
  if (!config.server.enableUaBlock) return next();
  const ua = String(req.get('user-agent') || '').toLowerCase();
  const hit = config.server.blockedUaKeywords.find((keyword) => ua.includes(keyword));
  if (!hit) return next();

  logger.risk({
    ip: req.ip,
    path: req.originalUrl,
    ua,
    reason: `blocked ua keyword: ${hit}`
  });

  return res.status(403).json({ message: 'Forbidden' });
});

app.use('/css', express.static(path.join(config.paths.webDir, 'css')));
app.use('/js', express.static(path.join(config.paths.webDir, 'js')));
app.use('/assets', express.static(path.join(config.paths.webDir, 'assets')));

app.get('/api/config', (req, res) => {
  res.json(config.site);
});

app.get('/api/jump/meta', (req, res) => {
  const link = config.links[String(req.query.id || '')];
  if (!link) {
    return res.status(404).json({ message: '线路不存在' });
  }

  logger.jump({
    action: 'meta',
    linkId: link.id,
    linkName: link.name,
    ip: req.ip,
    ua: req.get('user-agent') || ''
  });

  return res.json({
    id: link.id,
    name: link.name,
    badge: link.badge,
    seconds: config.site.jumpSeconds,
    title: config.site.jumpTitle,
    message: config.site.jumpMessage,
    footer: config.site.jumpFooter
  });
});

app.get('/api/jump/resolve', (req, res) => {
  const link = config.links[String(req.query.id || '')];
  if (!link) {
    return res.status(404).json({ message: '线路不存在' });
  }

  logger.jump({
    action: 'resolve',
    linkId: link.id,
    linkName: link.name,
    target: link.url,
    ip: req.ip,
    ua: req.get('user-agent') || '',
    referer: req.get('referer') || ''
  });

  return res.json({ url: link.url });
});

app.get('/', (req, res) => {
  res.sendFile(path.join(config.paths.webDir, 'index.html'));
});

app.get('/jump', (req, res) => {
  res.sendFile(path.join(config.paths.webDir, 'jump.html'));
});

app.get('/health', (req, res) => {
  res.json({ ok: true, uptime: process.uptime() });
});

app.use((req, res) => {
  res.status(404).send('Not Found');
});

app.use((err, req, res, next) => {
  logger.error({
    message: err.message,
    stack: err.stack,
    path: req.originalUrl,
    ip: req.ip
  });
  res.status(500).json({ message: 'Server Error' });
});

app.listen(config.server.port, () => {
  console.log(`nav-portal running on :${config.server.port}`);
});
