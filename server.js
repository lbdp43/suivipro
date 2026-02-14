import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const DIST = join(__dirname, 'dist');
const PORT = parseInt(process.env.PORT || '3000', 10);

const MIME = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

const indexHtml = readFileSync(join(DIST, 'index.html'));

createServer((req, res) => {
  const url = req.url.split('?')[0];
  const filePath = join(DIST, url);

  if (url !== '/' && existsSync(filePath) && !filePath.endsWith('/')) {
    const ext = extname(filePath);
    const mime = MIME[ext] || 'application/octet-stream';
    const file = readFileSync(filePath);
    // Cache static assets (hashed filenames)
    if (url.startsWith('/assets/')) {
      res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'public, max-age=31536000, immutable' });
    } else {
      res.writeHead(200, { 'Content-Type': mime });
    }
    res.end(file);
  } else {
    // SPA fallback: serve index.html for all routes
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(indexHtml);
  }
}).listen(PORT, '0.0.0.0', () => {
  console.log(`SuiviPro running on port ${PORT}`);
});
