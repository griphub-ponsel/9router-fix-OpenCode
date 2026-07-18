import { chromium } from 'playwright-core';

const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const consoleErrors = [];
const failedResponses = [];
page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
page.on('pageerror', (error) => consoleErrors.push(error.message));
page.on('response', (response) => { if (response.status() >= 400) failedResponses.push({ status: response.status(), url: response.url() }); });
await page.goto('http://127.0.0.1:23131/login', { waitUntil: 'networkidle' });
await page.getByPlaceholder('Enter password').fill('mobile-qa-password');
await Promise.all([page.waitForURL('**/dashboard'), page.getByRole('button', { name: 'Login' }).click()]);
await page.getByRole('button', { name: 'Menu' }).click();
const sidebarVisible = await page.locator('aside:visible').isVisible();
const logoVisible = await page.locator('aside:visible').getByAltText('9Router logo').isVisible();
const providers = page.locator('aside:visible').getByRole('link', { name: /Providers/ });
await providers.click();
await page.waitForURL('**/dashboard/providers');
const drawerRectAfterNavigation = await page.locator('aside').last().boundingBox();
const drawerClosedAfterNavigation = !drawerRectAfterNavigation || drawerRectAfterNavigation.x + drawerRectAfterNavigation.width <= 0;
await page.getByRole('button', { name: 'Menu' }).click();
await page.locator('aside:visible').getByRole('link', { name: /Combos/ }).click();
await page.waitForURL('**/dashboard/combos');
await page.waitForLoadState('networkidle');
await page.waitForTimeout(1000);
const heading = await page.locator('main h1').first().innerText();
const bodyWidth = await page.evaluate(() => ({ clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth }));
const headerTargets = await page.locator('header button, header a').evaluateAll((elements) => elements.map((element) => {
  const rect = element.getBoundingClientRect();
  return { name: element.getAttribute('aria-label') || element.getAttribute('title') || element.innerText.trim(), width: Math.round(rect.width), height: Math.round(rect.height) };
}));
const mainText = (await page.locator('main').innerText()).slice(0, 600);
await page.screenshot({ path: '/tmp/9router-vite-mobile.png', fullPage: false });
console.log(JSON.stringify({ sidebarVisible, logoVisible, drawerClosedAfterNavigation, drawerRectAfterNavigation, path: new URL(page.url()).pathname, heading, bodyWidth, headerTargets, mainText, consoleErrors, failedResponses }, null, 2));
await browser.close();
