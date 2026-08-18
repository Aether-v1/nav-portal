const fs = require('fs');
const path = require('path');

function appendJsonLine(filePath, data) {
  const line = JSON.stringify({ time: new Date().toISOString(), ...data }) + '\n';
  fs.appendFile(filePath, line, (err) => {
    if (err) {
      console.error('write log failed:', err.message);
    }
  });
}

function createLogger(logDir) {
  const accessFile = path.join(logDir, 'access.log');
  const jumpFile = path.join(logDir, 'jump.log');
  const riskFile = path.join(logDir, 'risk.log');
  const errorFile = path.join(logDir, 'error.log');

  return {
    access(data) {
      appendJsonLine(accessFile, data);
    },
    jump(data) {
      appendJsonLine(jumpFile, data);
    },
    risk(data) {
      appendJsonLine(riskFile, data);
    },
    error(data) {
      appendJsonLine(errorFile, data);
    }
  };
}

module.exports = {
  createLogger
};
