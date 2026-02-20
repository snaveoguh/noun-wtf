// Download and extract the official NounsDAO Ponder snapshot
// Skips if .ponder directory already exists
import { existsSync } from 'fs';
import { execSync } from 'child_process';
import https from 'https';
import http from 'http';
import { createWriteStream, unlinkSync } from 'fs';

const SNAPSHOT_URL = 'https://github.com/nounsDAO/nouns-monorepo/releases/download/snapshot/snapshot.tgz';
const SNAPSHOT_FILE = 'snapshot.tgz';

if (existsSync('.ponder')) {
  console.log('.ponder directory exists, skipping snapshot download');
  process.exit(0);
}

console.log('Downloading Ponder snapshot...');

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const makeRequest = (requestUrl) => {
      const lib = requestUrl.startsWith('https') ? https : http;
      lib.get(requestUrl, (res) => {
        // Follow redirects
        if (res.statusCode === 301 || res.statusCode === 302) {
          console.log(`Redirecting to ${res.headers.location.substring(0, 80)}...`);
          makeRequest(res.headers.location);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`Download failed: HTTP ${res.statusCode}`));
          return;
        }
        const totalBytes = parseInt(res.headers['content-length'], 10);
        let downloadedBytes = 0;
        const file = createWriteStream(dest);
        res.on('data', (chunk) => {
          downloadedBytes += chunk.length;
          if (totalBytes) {
            const pct = ((downloadedBytes / totalBytes) * 100).toFixed(1);
            process.stdout.write(`\rDownloading: ${pct}% (${(downloadedBytes/1024/1024).toFixed(1)}MB / ${(totalBytes/1024/1024).toFixed(1)}MB)`);
          }
        });
        res.pipe(file);
        file.on('finish', () => {
          file.close();
          console.log('\nDownload complete!');
          resolve();
        });
        file.on('error', reject);
      }).on('error', reject);
    };
    makeRequest(url);
  });
}

try {
  await download(SNAPSHOT_URL, SNAPSHOT_FILE);
  console.log('Extracting snapshot...');
  execSync(`tar -xzf ${SNAPSHOT_FILE}`, { stdio: 'inherit' });
  unlinkSync(SNAPSHOT_FILE);
  console.log('Snapshot restored successfully!');
} catch (err) {
  console.error('Snapshot restore failed:', err.message);
  console.log('Continuing without snapshot — Ponder will sync from scratch');
}
