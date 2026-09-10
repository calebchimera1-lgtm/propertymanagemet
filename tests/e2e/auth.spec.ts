import { expect, test } from '@playwright/test';

/**
 * Phase 1 workflow, end to end: create an organization, sign in, move around
 * the app shell, and sign out. Later phases extend this file with the property,
 * lease and payment journeys.
 */

function uniqueEmail(): string {
  return `owner+${Date.now()}${Math.floor(Math.random() * 1000)}@example.test`;
}

const PASSWORD = 'CorrectHorseBattery9';

test.describe('Authentication', () => {
  test('an unauthenticated visitor is sent to sign in', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  });

  test('registration creates an organization and lands on the dashboard', async ({ page }) => {
    const email = uniqueEmail();

    await page.goto('/register');
    await page.getByLabel('Organization name').fill('Playwright Properties');
    await page.getByLabel('Your full name').fill('Test Owner');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
    await page.getByLabel('Confirm password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Create organization' }).click();

    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.getByRole('heading', { name: /Welcome, Test/ })).toBeVisible();
    // The organization name appears in the sidebar and in the page subtitle;
    // assert the one the user actually reads on both layouts.
    await expect(
      page.getByText('Playwright Properties · KES · Africa/Nairobi'),
    ).toBeVisible();
  });

  test('a weak password is refused before the account is created', async ({ page }) => {
    await page.goto('/register');
    await page.getByLabel('Organization name').fill('Weak Password Co');
    await page.getByLabel('Your full name').fill('Test Owner');
    await page.getByLabel('Email').fill(uniqueEmail());
    await page.getByLabel('Password', { exact: true }).fill('short');
    await page.getByLabel('Confirm password').fill('short');
    await page.getByRole('button', { name: 'Create organization' }).click();

    await expect(page.getByText(/at least 12 characters/i).first()).toBeVisible();
    await expect(page).toHaveURL(/\/register/);
  });

  test('wrong credentials give a message that does not reveal whether the account exists', async ({
    page,
  }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill('definitely-not-registered@example.test');
    await page.getByLabel('Password').fill('WrongPassword123');
    await page.getByRole('button', { name: 'Sign in' }).click();

    // Scoped by text: Next.js renders an empty route-announcer with role=alert
    // on every page, which a bare getByRole('alert') would also match.
    await expect(
      page.getByRole('alert').filter({ hasText: 'Email or password is incorrect' }),
    ).toBeVisible();
  });

  test('a full sign-in, navigate and sign-out journey', async ({ page }) => {
    const email = uniqueEmail();

    await page.goto('/register');
    await page.getByLabel('Organization name').fill('Journey Estates');
    await page.getByLabel('Your full name').fill('Journey Owner');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
    await page.getByLabel('Confirm password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Create organization' }).click();
    await expect(page).toHaveURL(/\/dashboard/);

    await page.getByRole('button', { name: 'Account menu' }).click();
    await page.getByRole('menuitem', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/login/);

    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/dashboard/);

    await page.goto('/users');
    await expect(page.getByRole('heading', { name: 'Users' })).toBeVisible();
    // The desktop table and the mobile card list both contain the name; only
    // one of them is visible at a given viewport.
    await expect(page.getByText('Journey Owner').filter({ visible: true }).first()).toBeVisible();

    await page.goto('/settings');
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save organization' })).toBeVisible();
  });

  test('the dashboard shows no invented numbers before there is data', async ({ page }) => {
    const email = uniqueEmail();

    await page.goto('/register');
    await page.getByLabel('Organization name').fill('Honest Numbers Ltd');
    await page.getByLabel('Your full name').fill('Honest Owner');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
    await page.getByLabel('Confirm password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Create organization' }).click();
    await expect(page).toHaveURL(/\/dashboard/);

    // One real user, one real session — and an explicit statement that the
    // not-yet-built sections are not built yet, rather than empty metric cards.
    // The roadmap panel shrinks as phases ship: Phases 2 and 3 have landed, so
    // the next unbuilt section named here is Phase 4.
    await expect(page.getByText('People in your organization')).toBeVisible();
    await expect(page.getByText('Phase 4').first()).toBeVisible();
  });
});

test.describe('Mobile navigation', () => {
  test.skip(({ isMobile }) => !isMobile, 'Mobile layout only');

  test('navigation is a slide-over panel, not a squeezed sidebar', async ({ page }) => {
    const email = uniqueEmail();

    await page.goto('/register');
    await page.getByLabel('Organization name').fill('Mobile Estates');
    await page.getByLabel('Your full name').fill('Mobile Owner');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
    await page.getByLabel('Confirm password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Create organization' }).click();
    await expect(page).toHaveURL(/\/dashboard/);

    await page.getByRole('button', { name: 'Open navigation' }).click();
    const nav = page.getByRole('dialog');
    await expect(nav).toBeVisible();
    await nav.getByRole('link', { name: 'Settings' }).click();
    await expect(page).toHaveURL(/\/settings/);
  });
});
