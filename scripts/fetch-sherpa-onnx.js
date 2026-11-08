#!/usr/bin/env node
/**
 * Fetches the sherpa-onnx Android AAR (VAD, Whisper ASR, speaker embeddings, VITS/Piper TTS)
 * into a local Maven repository consumed by modules/dubix-native.
 *
 *   node scripts/fetch-sherpa-onnx.js            # download + verify (skips if already verified)
 *   DUBIX_SHERPA_AAR=/path/to.aar node scripts/fetch-sherpa-onnx.js   # use a local copy
 *
 * Pinned to 1.12.21: sherpa-onnx 2.x removed the built-in espeak-ng phonemizer, so Piper/VITS
 * voices produce no audio there. The AAR is fetched from the maintainers' Hugging Face mirror
 * (GitHub releases as fallback) and verified against its published SHA-256.
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');

const VERSION = '1.12.21';
const SHA256 = '4ce353cda9ab9e4c2e398dfd45aeb43cca1b5f97279051d354ebcdbd043e74ef';
const URLS = [
  `https://huggingface.co/csukuangfj/sherpa-onnx-libs/resolve/main/android/aar/sherpa-onnx-${VERSION}.aar`,
  `https://github.com/k2-fsa/sherpa-onnx/releases/download/v${VERSION}/sherpa-onnx-${VERSION}.aar`,
];

const repoDir = path.join(__dirname, '..', 'modules', 'dubix-native', 'android', 'maven', 'com', 'k2fsa', 'sherpa-onnx', VERSION);
const aarPath = path.join(repoDir, `sherpa-onnx-${VERSION}.aar`);
const pomPath = path.join(repoDir, `sherpa-onnx-${VERSION}.pom`);

const POM = `<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0">
  <modelVersion>4.0.0</modelVersion>
  <groupId>com.k2fsa</groupId>
  <artifactId>sherpa-onnx</artifactId>
  <version>${VERSION}</version>
  <packaging>aar</packaging>
</project>
`;

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function download(url, dest, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error('Too many redirects'));
    https
      .get(url, { headers: { 'User-Agent': 'dubix-setup' } }, (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
          res.resume();
          return resolve(download(res.headers.location, dest, redirects + 1));
        }
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        const total = Number(res.headers['content-length'] || 0);
        let got = 0;
        let lastPct = -1;
        const out = fs.createWriteStream(dest);
        res.on('data', (c) => {
          got += c.length;
          const pct = total ? Math.floor((got / total) * 100) : 0;
          if (pct !== lastPct && pct % 10 === 0) {
            process.stdout.write(`  ${pct}%\n`);
            lastPct = pct;
          }
        });
        res.pipe(out);
        out.on('finish', () => out.close(resolve));
        out.on('error', reject);
      })
      .on('error', reject);
  });
}

async function main() {
  fs.mkdirSync(repoDir, { recursive: true });
  fs.writeFileSync(pomPath, POM);
  if (fs.existsSync(aarPath) && sha256(aarPath) === SHA256) {
    console.log(`sherpa-onnx ${VERSION} already present and verified.`);
    return;
  }
  const local = process.env.DUBIX_SHERPA_AAR;
  const tmp = `${aarPath}.download`;
  if (local) {
    console.log(`Using local sherpa-onnx AAR: ${local}`);
    fs.copyFileSync(local, tmp);
  } else {
    let lastError;
    for (const url of URLS) {
      try {
        console.log(`Downloading sherpa-onnx ${VERSION} (~37 MB) from ${new URL(url).host}...`);
        await download(url, tmp);
        if (sha256(tmp) === SHA256) break;
        lastError = new Error('checksum mismatch');
      } catch (e) {
        lastError = e;
      }
    }
    if (!fs.existsSync(tmp)) throw lastError ?? new Error('download failed');
  }
  const actual = sha256(tmp);
  if (actual !== SHA256) {
    fs.unlinkSync(tmp);
    throw new Error(`Checksum mismatch for sherpa-onnx AAR (expected ${SHA256}, got ${actual})`);
  }
  fs.renameSync(tmp, aarPath);
  console.log('sherpa-onnx AAR installed and verified.');
}

main().catch((e) => {
  console.error(`[fetch-sherpa-onnx] ${e.message}`);
  // Do not break `npm install` for JS-only work (tests, type checks); Android builds will fail
  // loudly until the AAR is present.
  process.exitCode = process.env.CI ? 1 : 0;
});
