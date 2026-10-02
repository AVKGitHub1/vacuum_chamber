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
  const help = helpFor(page, path);
  await help.click();
  const tooltip = tooltipFor(page);
  await expect(tooltip).toBeVisible();
  await expect(help).toHaveAttribute('aria-expanded', 'true');
  await expect(help).toHaveAttribute('aria-controls', 'dimension-tooltip');
  await expect(tooltip).toHaveAttribute('role', 'tooltip');
  await expect(tooltip.getByRole('img')).toBeVisible();
  await expect(tooltip.locator('svg title')).not.toBeEmpty();
  const descriptionId = await help.getAttribute('aria-describedby');
  expect(descriptionId).toBeTruthy();
  await expect(tooltip.locator(`[id="${descriptionId}"]`)).not.toBeEmpty();
  expect((await tooltip.textContent()).trim().length).toBeGreaterThan(50);
  return tooltip;
}

// Keep exhaustive coverage in bounded groups: each field receives a real click
// without sharing one timeout across the entire long, scrollable form.
for (const [name, prefix] of [['body and end flanges', 'body.'], ['port A', 'ports.0.'], ['port B', 'ports.1.'], ['port C', 'ports.2.'], ['port D', 'ports.3.']]) {
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
        await expect(help).toHaveText('?');
        await expect(help).toHaveAttribute('type', 'button');
        await expect(help.locator('..').locator('label')).toBeVisible();
        await expect(help.locator('..').locator('label .dimension-help')).toHaveCount(0);
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

test('only question-mark activation opens help, with keyboard and pointer dismissal', async ({page}) => {
  const before = await savedConfig(page);
  const height = helpFor(page, 'body.height');
  const diameter = helpFor(page, 'body.od');
  const tooltip = tooltipFor(page);
  const title = height.locator('..').locator('label');
  await title.hover();
  await page.waitForTimeout(300);
  await expect(tooltip).toBeHidden();
  await title.click();
  await expect(page.locator('[data-path="body.height"]')).toBeFocused();
  await expect(tooltip).toBeHidden();
  await height.hover();
  await page.waitForTimeout(300);
  await expect(tooltip).toBeHidden();
  await height.focus();
  await expect(height).toBeFocused();
  await expect(tooltip).toBeHidden();
  await expect(height).toHaveAttribute('aria-expanded', 'false');

  await page.keyboard.press('Enter');
  await expect(tooltip).toBeVisible();
  await expect(height).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('Enter');
  await expect(tooltip).toBeHidden();
  await page.keyboard.press('Space');
  await expect(tooltip).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(height).toBeFocused();
  await expect(tooltip).toBeHidden();
  await expect(height).toHaveAttribute('aria-expanded', 'false');

  await page.locator('[data-path="body.od"]').focus();
  await page.keyboard.press('Tab');
  await expect(height).toBeFocused();
  await expect(tooltip).toBeHidden();
  await page.keyboard.press('Space');
  await expect(tooltip).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(page.locator('[data-path="body.height"]')).toBeFocused();
  await expect(tooltip).toBeHidden();

  await expectSchematic(page, 'body.height');
  await tooltip.click();
  await expect(tooltip).toBeVisible();
  await tooltip.hover();
  await page.mouse.move(0, 0);
  await page.waitForTimeout(300);
  await expect(tooltip).toBeVisible();
  await height.click();
  await expect(tooltip).toBeHidden();
  await expectSchematic(page, 'body.height');
  await diameter.click();
  await expect(tooltip).toBeVisible();
  await expect(tooltip).toContainText(/diameter/i);
  await expect(height).toHaveAttribute('aria-expanded', 'false');
  await expect(diameter).toHaveAttribute('aria-expanded', 'true');
  await page.locator('h1').click();
  await expect(tooltip).toBeHidden();
  expect(await savedConfig(page)).toBe(before);
  await expect(page.locator('[data-path="body.height"]')).toHaveValue('15');
  await expect(page.locator('#compute-state')).toHaveText('Up to date');
});

test('help survives units, new ports, profile changes, and field edits without a stale popover', async ({page}) => {
  const bodyBefore = JSON.parse(await savedConfig(page)).body;
  await expectSchematic(page, 'body.height');
  await page.locator('[data-unit="mm"]').click();
  await expect(tooltipFor(page)).toBeHidden();
  await expect(page.locator('[data-path="body.height"]')).toHaveValue('381');
  expect(JSON.parse(await savedConfig(page)).body).toEqual(bodyBefore);
  await expectSchematic(page, 'body.height');

  await page.locator('[data-duplicate="0"]').click();
  await expect(tooltipFor(page)).toBeHidden();
  await expectSchematic(page, 'ports.4.beta');
  await page.locator('[data-path="ports.4.flange"]').selectOption('ISO63F');
  // DOM replacement can dispatch pointer events under a stationary cursor.
  // Dismissal must last until the user activates a question mark again.
  await page.waitForTimeout(500);
  await expect(tooltipFor(page)).toBeHidden();
  await page.locator('.port-card').last().locator('details summary').click();
  await expectSchematic(page, 'ports.4.dimensions.sealDepth');
  await expect(helpFor(page, 'ports.4.dimensions.knifeHalfWidth')).toHaveCount(0);
  await page.locator('.port-card').last().locator('details summary').click();
  await expect(tooltipFor(page)).toBeHidden();

  await expectSchematic(page, 'ports.4.alpha');
  await page.locator('[data-path="ports.4.alpha"]').fill('240');
  await expect(tooltipFor(page)).toBeHidden();
  await expectSchematic(page, 'ports.4.alpha');
  await page.locator('[data-remove="4"]').click();
  await expect(tooltipFor(page)).toBeHidden();
  await expect(helpFor(page, 'ports.4.alpha')).toHaveCount(0);
});

test.describe('touch screen help', () => {
  test.use({viewport: {width: 390, height: 844}, hasTouch: true, isMobile: true});

  test('tapping a question mark toggles a readable schematic inside the mobile viewport', async ({page}, testInfo) => {
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
