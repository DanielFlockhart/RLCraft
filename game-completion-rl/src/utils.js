const fs = require('fs');
const path = require('path');

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function withTimeout(promise, ms, message) {
  let timeout = null;
  const timer = new Promise((_, reject) => {
    timeout = setTimeout(() => reject(new Error(message || `Timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timer]).finally(() => clearTimeout(timeout));
}

function nowStamp(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, '-');
}

function pad(num, width = 4) {
  return String(num).padStart(width, '0');
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeJson(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function appendJsonl(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.appendFileSync(filePath, JSON.stringify(value) + '\n');
}

function errorSummary(err) {
  if (!err) return null;
  return {
    name: err.name || 'Error',
    code: err.code || null,
    message: err.message || String(err)
  };
}

function isTransientNetworkError(err) {
  return [
    'ECONNRESET',
    'ECONNREFUSED',
    'EPIPE',
    'ETIMEDOUT',
    'ECONNABORTED',
    'ENOTFOUND'
  ].includes(err?.code);
}

module.exports = {
  sleep,
  withTimeout,
  nowStamp,
  pad,
  ensureDir,
  writeJson,
  appendJsonl,
  errorSummary,
  isTransientNetworkError
};
