// Count actual WebGL drawing without exposing renderer internals in the app.
import {test, expect} from '@playwright/test';

const drawCount = page => page.evaluate(() => window.previewDrawCalls);
const labelPositions = page => page.locator('#port-labels .port-label').evaluateAll(
  labels => labels.map(label => [label.style.left, label.style.top, label.style.display]));

async function expectIdle(page) {
  await expect.poll(() => page.evaluate(() => performance.now() - window.lastPreviewDraw),
    {message: 'The preview stops drawing when its camera and geometry are unchanged', timeout: 30_000})
    .toBeGreaterThan(500);
}

async function expectRedraw(page, action) {
  await expectIdle(page);
  const before = await drawCount(page);
  await action();
  await expect.poll(() => drawCount(page)).toBeGreaterThan(before);
  await expectIdle(page);
}

test('the preview rests when idle and redraws for camera, size, display, and geometry changes', async ({page}) => {
  await page.addInitScript(() => {
    window.previewDrawCalls = 0;
    window.lastPreviewDraw = 0;
    for (const Context of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) {
      if (!Context) continue;
      for (const name of ['drawArrays', 'drawElements']) {
        const original = Context.prototype[name];
        Context.prototype[name] = function (...args) {
          window.previewDrawCalls++;
          window.lastPreviewDraw = performance.now();
          return Reflect.apply(original, this, args);
        };
      }
    }
  });
  await page.goto('./');
  await expect(page.locator('#compute-state')).toHaveText('Up to date', {timeout: 120_000});
  await expect(page.locator('#webgl-error')).toBeHidden();
  await expect.poll(() => drawCount(page)).toBeGreaterThan(0);
  await expectIdle(page);
  const initialLabels = await labelPositions(page);

  await expectRedraw(page, () => page.locator('#view-top').click());
  expect(await labelPositions(page)).not.toEqual(initialLabels);
  await expectRedraw(page, () => page.locator('#view-front').click());
  await expectRedraw(page, () => page.locator('#fit').click());

  const beforeOrbit = await labelPositions(page);
  await expectRedraw(page, async () => {
    const box = await page.locator('#viewport canvas').boundingBox();
    const x = box.x + box.width / 2, y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 90, y + 35, {steps: 8});
    await page.mouse.up();
  });
  expect(await labelPositions(page)).not.toEqual(beforeOrbit);

  await expectRedraw(page, () => page.setViewportSize({width: 1280, height: 900}));
  await expectRedraw(page, () => page.locator('#transparent').check());
  await expectRedraw(page, async () => {
    await page.locator('[data-path="body.height"]').fill('21');
    await expect(page.locator('#compute-state')).toHaveText('Up to date');
  });
  await expectRedraw(page, async () => {
    await page.locator('[data-duplicate="0"]').click();
    await expect(page.locator('#compute-state')).toHaveText('Interference');
  });
  await expect(page.locator('#port-labels .port-label')).toHaveCount(3);
  const beforeLocate = await labelPositions(page);
  await expectRedraw(page, () => page.getByRole('button', {name: 'Locate'}).click());
  expect(await labelPositions(page)).not.toEqual(beforeLocate);
});
