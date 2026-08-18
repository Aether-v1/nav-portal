const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '..', '.env') });

function toBool(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return String(value).toLowerCase() === 'true';
}

function toNum(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function parseLinks() {
  const count = toNum(process.env.NAV_LINK_COUNT, 0);
  const links = [];

  for (let i = 1; i <= count; i += 1) {
    const enabled = toBool(process.env[`NAV_LINK_${i}_ENABLED`], false);
    const url = process.env[`NAV_LINK_${i}_URL`] || '';
    const ping = process.env[`NAV_LINK_${i}_PING`] || '';
    const name = process.env[`NAV_LINK_${i}_NAME`] || `线路 ${i}`;
    const badge = process.env[`NAV_LINK_${i}_BADGE`] || '';

    if (!enabled || !url) continue;

    links.push({
      id: i,
      name,
      badge,
      enabled,
      url,
      ping
    });
  }

  return links;
}

function getConfig() {
  const links = parseLinks();

  return {
    server: {
      port: toNum(process.env.PORT, 3000),
      trustProxy: toBool(process.env.TRUST_PROXY, true),
      enableAccessLog: toBool(process.env.ENABLE_ACCESS_LOG, true),
      enableUaBlock: toBool(process.env.ENABLE_UA_BLOCK, false),
      blockedUaKeywords: (process.env.BLOCKED_UA_KEYWORDS || '')
        .split(',')
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean)
    },
    site: {
      siteName: process.env.SITE_NAME || '导航站',
      siteDomain: process.env.SITE_DOMAIN || 'example.com',
      siteNotice: process.env.SITE_NOTICE || '谨防失联，牢记域名',
      siteSubtitle: process.env.SITE_SUBTITLE || '',
      primaryButtonText: process.env.PRIMARY_BUTTON_TEXT || '牢记域名',
      heroButtonText: process.env.HERO_BUTTON_TEXT || process.env.SITE_DOMAIN || 'example.com',
      jumpSeconds: toNum(process.env.JUMP_SECONDS, 5),
      jumpTitle: process.env.JUMP_TITLE || '正在建立安全连接',
      jumpMessage: process.env.JUMP_MESSAGE || '您与网站之间的访问链路正在进行云端优化，请稍候...',
      jumpFooter: process.env.JUMP_FOOTER || '云端加速引擎 · 安全链路验证',
      tg: {
        url: process.env.TG_URL || '',
        text: process.env.TG_TEXT || '官方TG群组'
      },
      downloads: {
        android: {
          url: process.env.DOWNLOAD_ANDROID || '',
          text: process.env.DOWNLOAD_ANDROID_TEXT || 'Android 下载'
        },
        windows: {
          url: process.env.DOWNLOAD_WINDOWS || '',
          text: process.env.DOWNLOAD_WINDOWS_TEXT || 'Windows 下载'
        },
        mac: {
          url: process.env.DOWNLOAD_MAC || '',
          text: process.env.DOWNLOAD_MAC_TEXT || 'Mac 下载'
        }
      },
      links
    },
    links: links.reduce((acc, item) => {
      acc[String(item.id)] = item;
      return acc;
    }, {}),
    paths: {
      logDir: path.join(__dirname, '..', 'logs'),
      webDir: path.join(__dirname, '..', 'web')
    }
  };
}

function ensureLogDir(logDir) {
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }
}

module.exports = {
  getConfig,
  ensureLogDir
};