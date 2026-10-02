// Exercise the field schematics in a real browser served from the Pages subpath.
import {test, expect} from '@playwright/test';

const helpFor = (page, path) => page.locator(`.dimension-help[data-help-path="${path}"]`);
const tooltipFor = page => page.locator('#dimension-tooltip');
const savedConfig = page => page.evaluate(() => localStorage.getItem('chamber-studio-v1'));

test.beforeEach(async ({page}) => {
  await page.goto('./');
  await expect(page.locator('#compute-state')).toHaveText('Up to date', {timeout: 120_000});
});

async function expectSchematic(page, path) {
  // Each coverage example begins after dismissing the preceding drawing.
  await page.keyboard.press('Escape');
  // Programmatic form filling does not move the pointer off the previous name.
  // Re-enter it so this really exercises a fresh user hover.
  await page.mouse.move(0, 0);
  const help = helpFor(page, path);
  await help.hover();
  const tooltip = tooltipFor(page);
  await expect(tooltip).toBeVisible();
  await expect(tooltip).toHaveAttribute('role', 'tooltip');
  await expect(tooltip.getByRole('img')).toBeVisible();
  await expect(tooltip.locator('svg title')).not.toBeEmpty();
  const descriptionId = await help.getAttribute('aria-describedby');
  expect(descriptionId).toBeTruthy();
  await expect(tooltip.locator(`[id="${descriptionId}"]`)).not.toBeEmpty();
  expect((await tooltip.textContent()).trim().length).toBeGreaterThan(50);
  return tooltip;
}

// Keep exhaustive coverage in bounded groups: each field still receives a real
// hover, without sharing one timeout across the entire long, scrollable form.
for (const [name, prefix] of [['body and end flanges', 'body.'], ['port A', 'ports.0.'], ['port B', 'ports.1.']]) {
  test(`every numeric field explains its dimension: ${name}`, async ({page}) => {
    // Keep both sealing families represented while opening all advanced dimensions.
    await page.locator('[data-path="body.top"]').selectOption('CF FXD');
    await page.locator('[data-path="body.bottom"]').selectOption('ISO-F');
    await expect(page.locator('#compute-state')).toHaveText('Up to date');
    for (const details of await page.locator('details[data-detail]').all()) {
      await details.locator('summary').click();
    }
    const fields = page.locator('.field input[type="number"]');
    const paths = await fields.evaluateAll(inputs => inputs.map(input => input.dataset.path));
    expect(paths).toContain('body.topSpec.knifeHalfWidth');
    expect(paths).toContain('body.bottomSpec.sealDepth');
    expect(paths).toContain('ports.0.dimensions.tubeWall');
    for (const path of ['body.od', ...paths].filter(path => path.startsWith(prefix))) {
      await test.step(path, async () => {
        const control = page.locator(`[data-path="${path}"]`);
        const help = helpFor(page, path);
        await expect(help).toHaveAccessibleName(/^Explain /);
        expect(await control.evaluate(input => Boolean(input.id
          && [...input.labels].some(label => label.htmlFor === input.id))),
        `The ${path} control keeps its label association`).toBe(true);
        await expectSchematic(page, path);
      });
    }
    await expect(page.locator('#dimension-tooltip')).toHaveCount(1);
  });
}

test('placement schematics describe the same reference axes and faces used by the builder', async ({page}, testInfo) => {
  const examples = [
    ['ports.0.elevation', [/bottom.*face/i, /focal|focus/i]],
    ['ports.0.focalLength', [/along.*port axis/i, /flange.*face/i, /centerline|centreline/i, /focus|focal/i]],
    ['ports.0.alpha', [/(counter|anti)clockwise/i, /\+X/, /top view|from above/i]],
    ['ports.0.beta', [/vertical|\+Z/i, /90/, /horizontal/i]],
  ];
  for (const [path, descriptions] of examples) {
    const tooltip = await expectSchematic(page, path);
    for (const description of descriptions) await expect(tooltip).toContainText(description);
    const filename = testInfo.outputPath(`${path.split('.').at(-1)}-schematic.png`);
    await tooltip.screenshot({path: filename});
    await testInfo.attach(path, {path: filename, contentType: 'image/png'});
  }
});

test('hover, pointer movement, keyboard focus, and dismissal preserve the configuration', async ({page}) => {
  const before = await savedConfig(page);
  const height = helpFor(page, 'body.height');
  const tooltip = await expectSchematic(page, 'body.height');
  await tooltip.hover();
  // Wait beyond the pointer-leave grace period to catch popovers that vanish
  // while the user moves from the field name onto the drawing.
  await page.waitForTimeout(500);
  await expect(tooltip).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(tooltip).toBeHidden();

  await page.locator('[data-path="body.od"]').focus();
  await page.keyboard.press('Tab');
  await expect(height).toBeFocused();
  await expect(tooltip).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(height).toBeFocused();
  await expect(tooltip).toBeHidden();
  await page.keyboard.press('Tab');
  await expect(page.locator('[data-path="body.height"]')).toBeFocused();

  await height.focus();
  await expect(tooltip).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(tooltip).toBeHidden();
  await expectSchematic(page, 'body.height');
  await page.locator('h1').click();
  await expect(tooltip).toBeHidden();
  await page.mouse.move(0, 0);
  await height.hover();
  await page.keyboard.press('Escape');
  // Escape must also cancel a drawing whose hover delay has not elapsed yet.
  await page.waitForTimeout(300);
  await expect(tooltip).toBeHidden();
  expect(await savedConfig(page)).toBe(before);
  await expect(page.locator('[data-path="body.height"]')).toHaveValue('20');
  await expect(page.locator('#compute-state')).toHaveText('Up to date');
});

test('help survives units, new ports, profile changes, and field edits without a stale popover', async ({page}) => {
  const bodyBefore = JSON.parse(await savedConfig(page)).body;
  await expectSchematic(page, 'body.height');
  await page.locator('[data-unit="mm"]').click();
  await expect(tooltipFor(page)).toBeHidden();
  await expect(page.locator('[data-path="body.height"]')).toHaveValue('508');
  expect(JSON.parse(await savedConfig(page)).body).toEqual(bodyBefore);
  await expectSchematic(page, 'body.height');

  await page.locator('[data-duplicate="0"]').click();
  await expect(tooltipFor(page)).toBeHidden();
  await expectSchematic(page, 'ports.2.beta');
  await page.locator('[data-path="ports.2.flange"]').selectOption('ISO63F');
  // DOM replacement can dispatch pointerover under a stationary cursor. Wait
  // beyond the hover delay to verify dismissal lasts, not just its first frame.
  await page.waitForTimeout(500);
  await expect(tooltipFor(page)).toBeHidden();
  await page.locator('.port-card').last().locator('details summary').click();
  await expectSchematic(page, 'ports.2.dimensions.sealDepth');
  await expect(helpFor(page, 'ports.2.dimensions.knifeHalfWidth')).toHaveCount(0);

  await expectSchematic(page, 'ports.2.alpha');
  await page.locator('[data-path="ports.2.alpha"]').fill('240');
  await expect(tooltipFor(page)).toBeHidden();
  await expectSchematic(page, 'ports.2.alpha');
  await page.locator('[data-remove="2"]').click();
  await expect(tooltipFor(page)).toBeHidden();
  await expect(helpFor(page, 'ports.2.alpha')).toHaveCount(0);
});

test.describe('touch screen help', () => {
  test.use({viewport: {width: 390, height: 844}, hasTouch: true, isMobile: true});

  test('tapping a name toggles a readable schematic inside the mobile viewport', async ({page}, testInfo) => {
    const before = await savedConfig(page);
    const help = helpFor(page, 'ports.0.beta');
    const tooltip = tooltipFor(page);
    await help.tap();
    await expect(tooltip).toBeVisible();
    await expect(tooltip.getByRole('img')).toBeVisible();
    const bounds = await tooltip.boundingBox();
    const viewport = await page.evaluate(() => ({width: innerWidth, height: innerHeight}));
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.y).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height);
    expect(await tooltip.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    const filename = testInfo.outputPath('mobile-dimension-help.png');
    await page.screenshot({path: filename});
    await testInfo.attach('mobile-dimension-help', {path: filename, contentType: 'image/png'});
    await help.tap();
    await expect(tooltip).toBeHidden();
    await help.tap();
    await expect(tooltip).toBeVisible();
    await page.locator('[data-path="ports.0.beta"]').tap();
    await expect(tooltip).toBeHidden();
    expect(await savedConfig(page)).toBe(before);
  });
});
