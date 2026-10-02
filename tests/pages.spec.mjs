// Real Chromium, dedicated Worker, Python and Manifold WASM, and WebGL.
// All application traffic must stay on a static GitHub project-style subpath.
import {test as base, expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';

const test = base.extend({
  staticTraffic: [async ({context, baseURL}, use) => {
    const requests = [];
    const errors = [];
    const allowed = new URL(baseURL);
    context.on('request', request => requests.push(request.url()));
    context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
    // Blocking unexpected traffic also makes an accidental CDN dependency fail.
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (['blob:', 'data:'].includes(url.protocol)
          || (url.origin === allowed.origin
              && url.pathname.startsWith(allowed.pathname)
              && !url.pathname.includes('/api/'))) {
        await route.continue();
      } else {
        await route.abort('blockedbyclient');
      }
    });
    await use(requests);
    expect(errors, 'No uncaught browser exceptions').toEqual([]);
    expect(requests.filter(value => {
      const url = new URL(value);
      return ['http:', 'https:'].includes(url.protocol)
        && (url.origin !== allowed.origin
            || !url.pathname.startsWith(allowed.pathname)
            || url.pathname.includes('/api/'));
    }), 'No backend, root-relative assets, or external runtime requests').toEqual([]);
  }, {auto: true}],
});

test.beforeEach(async ({page}) => {
  const workerReady = page.waitForEvent('worker');
  await page.goto('./');
  await workerReady;
  await expect(page.locator('#compute-state')).toHaveText('Up to date', {timeout: 120_000});
  await expect(page.locator('#export')).toBeEnabled();
});

test('starts on a project subpath with local WASM and a real 3D preview', async ({page, staticTraffic}, testInfo) => {
  await expect(page.locator('#webgl-error')).toBeHidden();
  await expect(page.locator('#viewport canvas')).toBeVisible();
  // Labels are created from returned port meshes, after real CSG evaluation.
  await expect(page.locator('#port-labels .port-label')).toHaveCount(2);
  await expect(page.locator('#collision-summary')).toContainText('No port collisions detected');
  expect(staticTraffic.filter(url => new URL(url).pathname.endsWith('.wasm')).length).toBeGreaterThanOrEqual(2);
  const preview = testInfo.outputPath('browser-geometry-preview.png');
  await page.locator('#viewport').screenshot({path: preview});
  await testInfo.attach('browser-geometry-preview', {path: preview, contentType: 'image/png'});
  const helpPromise = page.waitForEvent('popup');
  await page.getByRole('link', {name: 'Run in Fusion'}).click();
  const help = await helpPromise;
  await expect(help).toHaveURL(/\/vacuum_chamber\/fusion-help\.html$/);
  await expect(help.locator('body')).toContainText('Fusion');
});

test('unequal nested ports warn about coincident axes and clear after moving', async ({page}) => {
  await page.locator('[data-unit="mm"]').click();
  await page.locator('[data-path="ports.0.flange"]').selectOption('CF100');
  await page.locator('[data-path="ports.1.flange"]').selectOption('CF16');
  await page.locator('[data-path="ports.1.focalLength"]').fill('210');
  await page.locator('[data-path="ports.1.alpha"]').fill('0');
  await expect(page.locator('#compute-state')).toHaveText('Coincident ports');
  await expect(page.locator('#collision-summary')).toContainText('1 coincident port pair');
  await expect(page.locator('.collision-item')).toHaveCount(1);
  await expect(page.locator('.collision-item')).toContainText('Coincident axes (same position and direction)');
  await expect(page.locator('.port-state')).toHaveText(['Coincident', 'Coincident']);
  await expect(page.locator('.port-card.colliding')).toHaveCount(2);
  await expect(page.locator('#port-labels .bad')).toHaveCount(2);
  await expect(page.locator('#export')).toBeEnabled();
  await page.getByRole('button', {name: 'Locate'}).click();
  await expect(page.locator('.port-card.part-highlight')).toHaveCount(2);
  await page.locator('[data-path="ports.1.alpha"]').fill('180');
  await expect(page.locator('#compute-state')).toHaveText('Up to date');
  await expect(page.locator('.collision-item')).toHaveCount(0);
  await expect(page.locator('.port-card.colliding')).toHaveCount(0);
  await expect(page.locator('.port-state')).toHaveText(['Clear', 'Clear']);
});

test('duplicate solids report interference and still download a Fusion script', async ({page}, testInfo) => {
  await page.locator('[data-duplicate="0"]').click();
  await expect(page.locator('#compute-state')).toHaveText('Interference');
  await expect(page.locator('.port-card.colliding')).toHaveCount(2);
  await expect(page.locator('.collision-item')).toContainText('tube / tube');
  await expect(page.locator('.collision-item')).toContainText('Coincident axes');
  await expect(page.locator('#export')).toBeEnabled();
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#export').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('Chamber.py');
  expect(await download.failure()).toBeNull();
  const filename = testInfo.outputPath('Chamber.py');
  await download.saveAs(filename);
  const script = await readFile(filename, 'utf8');
  expect(script).toMatch(/^# Generated by/);
  expect(script).toContain('import adsk.core');
  expect(script).toContain('def run(context):');
});

test('invalid dimensions block export, and correction restores it', async ({page}) => {
  await page.locator('[data-path="body.height"]').fill('-1');
  await expect(page.locator('#compute-state')).toHaveText('Check inputs');
  await expect(page.locator('#validation')).toContainText('Chamber height must be a finite positive dimension');
  await expect(page.locator('#export')).toBeDisabled();
  await page.locator('[data-path="body.height"]').fill('20');
  await expect(page.locator('#compute-state')).toHaveText('Up to date');
  await expect(page.locator('#validation')).toBeEmpty();
  await expect(page.locator('#export')).toBeEnabled();
});

test('save and open exchange portable millimeter configurations', async ({page}) => {
  await page.locator('#notes').fill('Portable Pages chamber');
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#save').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('chamber-config.json');
  const filename = await download.path();
  const config = JSON.parse(await readFile(filename, 'utf8'));
  expect(config.schemaVersion).toBe(1);
  expect(config.units).toBe('in');
  expect(config.body.height).toBe(508);
  expect(config.notes).toBe('Portable Pages chamber');
  await page.locator('#notes').fill('Changed after saving');
  await page.locator('[data-path="body.height"]').fill('21');
  await expect(page.locator('#compute-state')).toHaveText('Up to date');
  await page.locator('#open-file').setInputFiles(filename);
  await expect(page.locator('#notes')).toHaveValue('Portable Pages chamber');
  await expect(page.locator('[data-path="body.height"]')).toHaveValue('20');
  await expect(page.locator('#compute-state')).toHaveText('Up to date');
  await expect(page.locator('#export')).toBeEnabled();
});
