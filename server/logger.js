const fs = require('fs');
const path = require('path');

function anonymizeIp(ip) {
  if (!ip) return '';
  const v4 = ip.match(/^(\d{1,3}\.\d{1,3})\.\d{1,3}\.\d{1,3}$/);
  if (v4) return `${v4[1]}.x.x`;
  const v6 = ip.match(/^([0-9a-fA-F:]+?):[0-9a-fA-F:]+$/);
  if (v6 && ip.includes(':')) return `${v6[1]}::x`;
  return ip;
}

function rotateIfNeeded(filePath, maxSize, maxFiles) {
  try {
    if (!fs.existsSync(filePath)) return;
    const stat = fs.statSync(filePath);
    if (stat.size < maxSize) return;

    for (let i = maxFiles - 1; i >= 1; i -= 1) {
      const src = `${filePath}.${i}`;
      const dest = `${filePath}.${i + 1}`;
      if (fs.existsSync(src)) {
        if (i + 1 > maxFiles) {
          fs.unlinkSync(src);
        } else {
          fs.renameSync(src, dest);
        }
      }
    }
    fs.renameSync(filePath, `${filePath}.1`);
  } catch (err) {
    console.error('log rotation failed:', err.message);
  }
}

function createLogger(logDir, options = {}) {
  const {
    maxFileSize = 10 * 1024 * 1024,
    maxFiles = 5,
    anonymizeIp: shouldAnonymize = false
  } = options;

  const accessFile = path.join(logDir, 'access.log');
  const jumpFile = path.join(logDir, 'jump.log');
  const riskFile = path.join(logDir, 'risk.log');
  const errorFile = path.join(logDir, 'error.log');

  function appendJsonLine(filePath, data) {
    try {
      rotateIfNeeded(filePath, maxFileSize, maxFiles);
    } catch (_) {}

    const line = JSON.stringify({ time: new Date().toISOString(), ...data }) + '\n';
    fs.appendFile(filePath, line, (err) => {
      if (err) {
        console.error('write log failed:', err.message);
      }
    });
  }

  function sanitize(data) {
    if (!shouldAnonymize) return data;
    const result = { ...data };
    if (result.ip) result.ip = anonymizeIp(result.ip);
    return result;
  }

  return {
    access(data) {
      appendJsonLine(accessFile, sanitize(data));
    },
    jump(data) {
      appendJsonLine(jumpFile, sanitize(data));
    },
    risk(data) {
      appendJsonLine(riskFile, sanitize(data));
    },
    error(data) {
      appendJsonLine(errorFile, data);
    }
  };
}

module.exports = {
  createLogger,
  anonymizeIp
};