// A deliberately static host: there is no Python process or /api fallback.
// The project prefix exercises the same URL layout as GitHub project Pages.
import http from 'node:http';
import {createReadStream} from 'node:fs';
import {stat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('../dist/', import.meta.url));
const prefix = '/vacuum_chamber/';
const port = Number(process.env.PAGES_TEST_PORT || 4173);
const types = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.py': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://localhost');
    if (url.pathname === prefix.slice(0, -1)) {
      response.writeHead(301, {Location: prefix});
      response.end();
      return;
    }
    if (!['GET', 'HEAD'].includes(request.method)
        || !url.pathname.startsWith(prefix)
        || url.pathname.includes('/api/')) {
      response.writeHead(404);
      response.end('Not found');
      return;
    }
    const relative = decodeURIComponent(url.pathname.slice(prefix.length));
    const filename = path.resolve(root, relative || 'index.html');
    const traversal = path.relative(root, filename);
    if (traversal.startsWith('..') || path.isAbsolute(traversal)) {
      response.writeHead(404);
      response.end('Not found');
      return;
    }
    const info = await stat(filename);
    if (!info.isFile()) throw new Error('Not a file');
    response.writeHead(200, {
      'Content-Type': types[path.extname(filename)] || 'application/octet-stream',
      'Content-Length': info.size,
      'Cache-Control': 'no-store',
    });
    if (request.method === 'HEAD') response.end();
    else createReadStream(filename).pipe(response);
  } catch {
    response.writeHead(404);
    response.end('Not found');
  }
}).listen(port, '127.0.0.1', () => {
  console.log(`Static Pages test host: http://127.0.0.1:${port}${prefix}`);
});
