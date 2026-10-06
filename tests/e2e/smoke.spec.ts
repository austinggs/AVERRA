import { expect, test } from '@playwright/test';

// Public-page smoke checks. The app shell (TopNav / BottomNav / More sheet)
// requires an authenticated session, so its behaviour is covered by
// tests/ui/navigation.test.tsx; these specs cover what a browser sees without
// a session: routing and horizontal overflow at each project's viewport.

test('the root path is public and renders', async ({ page }) => {
  const response = await page.goto('/');
  expect(response?.status()).toBeLessThan(400);
  await expect(page.locator('body')).toBeVisible();
});

test('an app path redirects an unauthenticated visitor to sign-in', async ({ page }) => {
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/sign-in/);
});

test('sign-in renders with no horizontal overflow', async ({ page }) => {
  await page.goto('/sign-in');
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();

  // scrollWidth > clientWidth means the page can be swiped sideways - the
  // classic mobile layout defect.
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);
});
