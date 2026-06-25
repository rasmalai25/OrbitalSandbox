// client/tests/phase2.spec.js
// Automated Phase 2 tests using Playwright.
// Run with: npx playwright test tests/phase2.spec.js --headed

import { test, expect } from '@playwright/test';

const BASE = 'http://localhost:5173';

test.describe('Phase 2 — Celestial Body System', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto(BASE);
    // Wait for canvas to be present
    await page.waitForSelector('#simulation-canvas', { timeout: 10000 });
    // Small settle time for physics engine to init
    await page.waitForTimeout(500);
  });

  // ── Test 1: Page loads, canvas visible ──────────────
  test('Canvas and toolbar render on load', async ({ page }) => {
    const canvas = page.locator('#simulation-canvas');
    await expect(canvas).toBeVisible();

    // Toolbar buttons present
    await expect(page.locator('#toolbar-btn-star')).toBeVisible();
    await expect(page.locator('#toolbar-btn-planet')).toBeVisible();
    await expect(page.locator('#toolbar-btn-moon')).toBeVisible();
    await expect(page.locator('#toolbar-btn-asteroid')).toBeVisible();
    await expect(page.locator('#toolbar-btn-black_hole')).toBeVisible();

    console.log('✅ Canvas and all 5 toolbar buttons visible');
  });

  // ── Test 2: Body counter starts at 0 ────────────────
  test('Body counter starts at 0', async ({ page }) => {
    const bodies = page.locator('.hud-value').first();
    await expect(bodies).toHaveText('0');
    console.log('✅ Body counter starts at 0');
  });

  // ── Test 3: Click places a planet, counter increments ─
  test('Click on canvas places a planet and increments counter', async ({ page }) => {
    const canvas = page.locator('#simulation-canvas');
    const box = await canvas.boundingBox();

    // Click center of canvas
    await canvas.click({ position: { x: box.width / 2, y: box.height / 2 } });
    await page.waitForTimeout(200);

    // Counter should be 1
    const counter = page.locator('.hud-value').first();
    await expect(counter).toHaveText('1');
    console.log('✅ Body counter incremented to 1 after click');
  });

  // ── Test 4: Toolbar switches selected type ────────────
  test('Clicking toolbar buttons switches body type', async ({ page }) => {
    await page.locator('#toolbar-btn-star').click();
    await page.waitForTimeout(100);
    // Active class should be on Star button
    await expect(page.locator('#toolbar-btn-star')).toHaveClass(/toolbar-btn--active/);
    await expect(page.locator('#toolbar-btn-planet')).not.toHaveClass(/toolbar-btn--active/);

    await page.locator('#toolbar-btn-black_hole').click();
    await expect(page.locator('#toolbar-btn-black_hole')).toHaveClass(/toolbar-btn--active/);
    console.log('✅ Toolbar correctly switches active body type');
  });

  // ── Test 5: Keyboard shortcuts 1-5 switch type ────────
  test('Keys 1-5 switch body types', async ({ page }) => {
    await page.keyboard.press('1');
    await page.waitForTimeout(100);
    await expect(page.locator('#toolbar-btn-star')).toHaveClass(/toolbar-btn--active/);

    await page.keyboard.press('3');
    await page.waitForTimeout(100);
    await expect(page.locator('#toolbar-btn-moon')).toHaveClass(/toolbar-btn--active/);

    await page.keyboard.press('5');
    await page.waitForTimeout(100);
    await expect(page.locator('#toolbar-btn-black_hole')).toHaveClass(/toolbar-btn--active/);
    console.log('✅ Keyboard shortcuts 1-5 switch body types correctly');
  });

  // ── Test 6: Place 3 bodies, press C → counter resets ──
  test('C key clears all bodies', async ({ page }) => {
    const canvas = page.locator('#simulation-canvas');
    const box = await canvas.boundingBox();

    await canvas.click({ position: { x: box.width * 0.3, y: box.height * 0.5 } });
    await canvas.click({ position: { x: box.width * 0.5, y: box.height * 0.5 } });
    await canvas.click({ position: { x: box.width * 0.7, y: box.height * 0.5 } });
    await page.waitForTimeout(300);

    let counter = page.locator('.hud-value').first();
    await expect(counter).toHaveText('3');

    await page.keyboard.press('c');
    await page.waitForTimeout(200);
    await expect(counter).toHaveText('0');
    console.log('✅ C key clears all bodies, counter resets to 0');
  });

  // ── Test 7: PropertyPanel visible with mass input ─────
  test('PropertyPanel has mass input and speed slider', async ({ page }) => {
    await expect(page.locator('#pp-mass')).toBeVisible();
    await expect(page.locator('#pp-speed')).toBeVisible();
    console.log('✅ PropertyPanel mass + speed controls visible');
  });

  // ── Test 8: Mass input changes value ──────────────────
  test('Mass input accepts user value', async ({ page }) => {
    const massInput = page.locator('#pp-mass');
    await massInput.triple_click?.() ?? await massInput.click({ clickCount: 3 });
    await massInput.fill('5000');
    await expect(massInput).toHaveValue('5000');
    console.log('✅ Mass input accepts custom value');
  });

  // ── Test 9: Place multiple types ──────────────────────
  test('Can place all 5 body types without errors', async ({ page }) => {
    const canvas = page.locator('#simulation-canvas');
    const box = await canvas.boundingBox();
    const types = ['star', 'planet', 'moon', 'asteroid', 'black_hole'];
    const positions = [0.2, 0.35, 0.5, 0.65, 0.8];

    for (let i = 0; i < types.length; i++) {
      await page.locator(`#toolbar-btn-${types[i]}`).click();
      await page.waitForTimeout(100);
      await canvas.click({ position: { x: box.width * positions[i], y: box.height * 0.5 } });
      await page.waitForTimeout(150);
    }

    const counter = page.locator('.hud-value').first();
    await expect(counter).toHaveText('5');
    console.log('✅ All 5 body types placed successfully, counter = 5');
  });

  // ── Test 10: No console errors ────────────────────────
  test('No console errors on load', async ({ page }) => {
    const errors = [];
    page.on('console', msg => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    page.on('pageerror', err => errors.push(err.message));

    await page.reload();
    await page.waitForSelector('#simulation-canvas');
    await page.waitForTimeout(1000);

    const criticalErrors = errors.filter(e =>
      !e.includes('favicon') &&
      !e.includes('socket') // socket connect errors are expected without a running server
    );

    expect(criticalErrors.length).toBe(0);
    if (criticalErrors.length === 0) {
      console.log('✅ No critical console errors on load');
    } else {
      console.log('❌ Errors found:', criticalErrors);
    }
  });

});
