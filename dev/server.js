'use strict';
/**
 * Local preview: serves the real Index.html and runs the real src/*.gs against a fake workbook.
 *   npm run dev            then open http://localhost:5173/?as=por@gmail.com
 * "as" picks the signed-in Google account (stored in a cookie). The clock is fixed at 25 Oct 2026
 * so the sample household always looks the same.
 */
const http = require('node:http');
const { createGas } = require('./gas-mock');
const { seedSample } = require('./sample-data');

const SHIM = `
window.google = { script: { get run() {
  const make = (ok, bad) => new Proxy({}, { get(_, name) {
    if (name === 'withSuccessHandler') return (fn) => make(fn, bad);
    if (name === 'withFailureHandler') return (fn) => make(ok, fn);
    return (...args) => fetch('/rpc/' + String(name), { method: 'POST', body: JSON.stringify(args) })
      .then((r) => r.json()).then((v) => ok && ok(v)).catch((e) => bad && bad(e));
  } });
  return make();
} } };`;

function startServer({ port = 5173, sample = true, email = 'por@gmail.com' } = {}) {
  const gas = createGas({ email, now: '2026-10-25T04:30:00Z' });
  if (sample) seedSample(gas);
  const delay = Number(process.env.DEV_DELAY_MS || 0);

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const cookie = /(?:^|; )as=([^;]*)/.exec(req.headers.cookie || '');
    const asParam = url.searchParams.get('as');
    const as = asParam || (cookie ? decodeURIComponent(cookie[1]) : email);

    if (req.method === 'GET' && url.pathname === '/') {
      const page = gas.run("HtmlService.createTemplateFromFile('Index').evaluate().getContent()")
        .replace('<?!= include_(\'Styles\') ?>', '')
        .replace('<head>', `<head><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><script>${SHIM}</script>`);
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'set-cookie': `as=${encodeURIComponent(as)}; Path=/` });
      return res.end(page);
    }
    if (req.method === 'POST' && url.pathname === '/rpc/api') {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        const [action, payload] = JSON.parse(body);
        const out = gas.request(action, payload, as === 'none' ? '' : as);
        setTimeout(() => {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify(out));
        }, delay);
      });
      return undefined;
    }
    res.writeHead(404);
    return res.end('not found');
  });

  return new Promise((resolve) => server.listen(port, () => resolve({ server, gas, url: `http://localhost:${server.address().port}` })));
}

module.exports = { startServer };

if (require.main === module) {
  startServer({ port: Number(process.env.PORT || 5173) }).then(({ url }) => {
    console.log(`ZBFinancial preview: ${url}/?as=por@gmail.com`);
    console.log('other accounts: mae@gmail.com (admin) · mew@gmail.com (member) · yai@gmail.com (viewer) · stranger@gmail.com (not invited)');
  });
}
