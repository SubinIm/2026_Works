import http from 'node:http';
import { readFile } from 'node:fs/promises';

// This server only serves these fixture files and only listens on IPv4 loopback.
const files = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/frame.html', ['frame.html', 'text/html; charset=utf-8']],
  ['/sample.svg', ['sample.svg', 'image/svg+xml']],
]);
const port = Number(process.argv[2] || 8766);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error('Usage: node adblocker/fixtures/server.mjs [port: 1..65535]');
  process.exit(1);
}
const server = http.createServer(async (request, response) => {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { Allow: 'GET, HEAD' }).end();
    return;
  }
  let path;
  try {
    path = new URL(request.url, `http://127.0.0.1:${port}`).pathname;
  } catch {
    response.writeHead(400).end('Invalid request');
    return;
  }
  const file = files.get(path);
  if (!file) {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
    return;
  }
  try {
    const body = await readFile(new URL(file[0], import.meta.url));
    response.writeHead(200, {
      'Content-Type': file[1],
      'Content-Length': body.length,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    response.end(request.method === 'HEAD' ? undefined : body);
  } catch {
    response.writeHead(500).end('Fixture read failed');
  }
});
server.on('error', error => {
  console.error(`Fixture server: ${error.message}`);
  process.exitCode = 1;
});
server.listen(port, '127.0.0.1', () => {
  console.log(`Ad-blocker fixture: http://127.0.0.1:${port}/`);
  console.log('Press Ctrl+C to stop. This fixture makes no external network requests.');
});
