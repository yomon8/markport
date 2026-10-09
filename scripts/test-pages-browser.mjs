import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { resolve, extname, sep } from 'node:path';
import { chromium } from '../web/node_modules/playwright/index.mjs';

assert.ok(process.argv[2], 'Usage: node scripts/test-pages-browser.mjs <Jekyll output directory>');
const destination = resolve(process.argv[2]);
const server = createServer((request, response) => {
  const url = new URL(request.url, 'http://localhost');
  const path = resolve(destination, decodeURIComponent(url.pathname).replace(/^\/markport\//, '') || 'index.html');
  try {
    if (!path.startsWith(destination + sep) || !statSync(path).isFile()) {
      response.writeHead(404).end();
      return;
    }
    response.setHeader('content-type', {
      '.html': 'text/html; charset=utf-8',
      '.css': 'text/css',
      '.png': 'image/png',
      '.svg': 'image/svg+xml',
    }[extname(path)] || 'application/octet-stream');
    response.end(readFileSync(path));
  } catch {
    response.writeHead(404).end();
  }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
let browser;
try {
  browser = await chromium.launch();
  for (const [file, lang, label] of [
    ['index.html', 'en-US', 'More screenshots'],
    ['README.ja.html', 'ja', 'その他のスクリーンショット'],
  ]) {
    for (const width of [1280, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      await page.route('https://**', route => route.abort());
      await page.goto(`http://127.0.0.1:${server.address().port}/markport/${file}`, { waitUntil: 'networkidle' });
      assert.equal(await page.locator('html').getAttribute('lang'), lang);
      assert.equal(await page.locator('h1').count(), 1);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      const summary = page.getByText(label, { exact: true });
      await summary.click();
      const images = page.locator('.markdown-body img[src*="screenshots/"]');
      for (const img of await images.all()) {
        await img.scrollIntoViewIfNeeded();
        await img.evaluate(element => element.decode());
        const dimensions = await img.evaluate(element => ({
          width: element.getBoundingClientRect().width,
          height: element.getBoundingClientRect().height,
          naturalWidth: element.naturalWidth,
          naturalHeight: element.naturalHeight,
        }));
        assert.ok(dimensions.naturalWidth > 0);
        const expectedHeight = dimensions.width * dimensions.naturalHeight / dimensions.naturalWidth;
        assert.ok(Math.abs(dimensions.height - expectedHeight) < 1, 'Screenshot must retain its aspect ratio');
      }
      await summary.click();
      await page.evaluate(() => scrollTo(0, 0));
      await page.screenshot({ path: `/tmp/markport-pages-${lang}-${width}.png` });
      await page.close();
      console.log(`${file}: ${width}px layout, image loading and aspect ratios passed`);
    }
  }
} finally {
  await browser?.close();
  server.close();
}
