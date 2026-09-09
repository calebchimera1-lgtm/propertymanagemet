import { expect, test } from '@playwright/test';

/**
 * Phase 2 workflow end to end: build a portfolio, then browse and filter it.
 *
 * Runs on desktop and mobile. The mobile run matters because the tables become
 * stacked cards below `md`, which is a different rendering path.
 */

const PASSWORD = 'CorrectHorseBattery9';

function unique(prefix: string): string {
  return `${prefix}-${Date.now()}${Math.floor(Math.random() * 1000)}`;
}

/**
 * Form fields are looked up inside the dialog, not on the page.
 *
 * The properties screen has a search box labelled "Search name, address or
 * city", which a page-level getByLabel('Name') also matches.
 */
function dialog(page: import('@playwright/test').Page) {
  return page.getByRole('dialog');
}

/**
 * A row appears twice in the DOM — once in the desktop table, once in the
 * mobile card list — and CSS hides whichever does not suit the viewport. This
 * narrows to the one the user can actually see.
 */
function row(page: import('@playwright/test').Page, text: string) {
  return page.getByText(text).filter({ visible: true });
}

async function signUp(page: import('@playwright/test').Page, organizationName: string) {
  const email = `${unique('owner')}@example.test`;
  await page.goto('/register');
  await page.getByLabel('Organization name').fill(organizationName);
  await page.getByLabel('Your full name').fill('Portfolio Owner');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByLabel('Confirm password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create organization' }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  return email;
}

test.describe('Portfolio', () => {
  test('an owner builds a property, a building and a unit, and sees the numbers add up', async ({
    page,
  }) => {
    await signUp(page, unique('Estates'));

    // ── Property ──────────────────────────────────────────────────────────
    await page.goto('/properties');
    await expect(page.getByRole('heading', { name: 'Properties' })).toBeVisible();
    await expect(page.getByText('No properties yet')).toBeVisible();

    await page.getByRole('button', { name: 'Add property' }).first().click();
    await dialog(page).getByLabel('Name').fill('Sunrise Estate');
    await dialog(page).getByLabel('City').fill('Nairobi');
    await dialog(page).getByRole('button', { name: 'Create property' }).click();

    await expect(page.getByText('No properties yet')).toBeHidden();
    await row(page, 'Sunrise Estate').first().click();
    await expect(page).toHaveURL(/\/properties\/c[a-z0-9]+/);

    // A brand-new property reports zeroes, not blanks or invented figures.
    await expect(page.getByText('0%')).toBeVisible();

    // ── Building ──────────────────────────────────────────────────────────
    await page.getByRole('tab', { name: 'Buildings' }).click();
    await page.getByRole('button', { name: 'Add building' }).click();
    await dialog(page).getByLabel('Name').fill('Block A');
    await dialog(page).getByLabel('Floors').fill('4');
    await dialog(page).getByRole('button', { name: 'Create building' }).click();
    await expect(row(page, 'Block A').first()).toBeVisible();

    // ── Unit ──────────────────────────────────────────────────────────────
    await page.getByRole('tab', { name: 'Units' }).click();
    await page.getByRole('button', { name: 'Add unit' }).click();
    await dialog(page).getByLabel('Unit number').fill('A1');
    await dialog(page).getByLabel('Monthly rent').fill('32000');
    await dialog(page).getByRole('button', { name: 'Create unit' }).click();

    await expect(row(page, 'A1').first()).toBeVisible();
    // Money is formatted from the string the API returned; it is never parsed
    // into a number in the browser.
    await expect(page.getByText(/32,000\.00/).filter({ visible: true }).first()).toBeVisible();

    // ── The overview reflects what was built ──────────────────────────────
    await page.getByRole('tab', { name: 'Overview' }).click();
    await expect(page.getByText('Potential monthly rent')).toBeVisible();
    await expect(page.getByText('At full occupancy. Not collected income.')).toBeVisible();
    await expect(page.getByText(/32,000\.00/).filter({ visible: true }).first()).toBeVisible();
  });

  test('a duplicate property name is refused on the field, not silently accepted', async ({
    page,
  }) => {
    await signUp(page, unique('Duplicates'));

    await page.goto('/properties');
    await page.getByRole('button', { name: 'Add property' }).first().click();
    await dialog(page).getByLabel('Name').fill('Riverside Court');
    await dialog(page).getByRole('button', { name: 'Create property' }).click();
    await expect(page.getByRole('dialog')).toBeHidden();

    await page.getByRole('button', { name: 'Add property' }).first().click();
    await dialog(page).getByLabel('Name').fill('Riverside Court');
    await dialog(page).getByRole('button', { name: 'Create property' }).click();

    await expect(dialog(page).getByText('This name is already in use.')).toBeVisible();
    // The dialog stays open with the value intact so it can be corrected.
    await expect(page.getByRole('dialog')).toBeVisible();
  });

  test('an invalid rent is caught before the request is sent', async ({ page }) => {
    await signUp(page, unique('Validation'));

    await page.goto('/properties');
    await page.getByRole('button', { name: 'Add property' }).first().click();
    await dialog(page).getByLabel('Name').fill('Validation Estate');
    await dialog(page).getByRole('button', { name: 'Create property' }).click();
    await expect(page.getByRole('dialog')).toBeHidden();

    await page.goto('/units');
    await page.getByRole('button', { name: 'Add unit' }).first().click();
    await dialog(page).getByLabel('Property').click();
    await page.getByRole('option', { name: 'Validation Estate' }).click();
    await dialog(page).getByLabel('Unit number').fill('A1');
    await dialog(page).getByLabel('Monthly rent').fill('not-a-number');
    await dialog(page).getByRole('button', { name: 'Create unit' }).click();

    await expect(dialog(page).getByText(/Enter an amount such as/).first()).toBeVisible();
  });

  test('filtering and searching narrow the unit list', async ({ page }) => {
    await signUp(page, unique('Filters'));

    await page.goto('/properties');
    await page.getByRole('button', { name: 'Add property' }).first().click();
    await dialog(page).getByLabel('Name').fill('Filter Estate');
    await dialog(page).getByRole('button', { name: 'Create property' }).click();
    await expect(page.getByRole('dialog')).toBeHidden();

    await row(page, 'Filter Estate').first().click();
    await page.getByRole('tab', { name: 'Units' }).click();

    for (const [number, rent] of [
      ['LOW-1', '10000'],
      ['HIGH-1', '90000'],
    ]) {
      await page.getByRole('button', { name: 'Add unit' }).click();
      await dialog(page).getByLabel('Unit number').fill(number as string);
      await dialog(page).getByLabel('Monthly rent').fill(rent as string);
      await dialog(page).getByRole('button', { name: 'Create unit' }).click();
      await expect(page.getByRole('dialog')).toBeHidden();
    }

    await page.goto('/units');
    await expect(row(page, 'LOW-1').first()).toBeVisible();
    await expect(row(page, 'HIGH-1').first()).toBeVisible();

    await page.getByLabel('Search unit number').fill('HIGH');
    await expect(row(page, 'LOW-1')).toHaveCount(0);
    await expect(row(page, 'HIGH-1').first()).toBeVisible();

    // Clearing the filters brings both back.
    await page.getByRole('button', { name: 'Clear' }).click();
    await expect(row(page, 'LOW-1').first()).toBeVisible();
  });

  test('deleting a building keeps its units and moves them to the property', async ({ page }) => {
    await signUp(page, unique('Detach'));

    await page.goto('/properties');
    await page.getByRole('button', { name: 'Add property' }).first().click();
    await dialog(page).getByLabel('Name').fill('Detach Estate');
    await dialog(page).getByRole('button', { name: 'Create property' }).click();
    await expect(page.getByRole('dialog')).toBeHidden();

    await row(page, 'Detach Estate').first().click();
    await page.getByRole('tab', { name: 'Buildings' }).click();
    await page.getByRole('button', { name: 'Add building' }).click();
    await dialog(page).getByLabel('Name').fill('Doomed Block');
    await dialog(page).getByRole('button', { name: 'Create building' }).click();
    await expect(page.getByRole('dialog')).toBeHidden();

    await row(page, 'Doomed Block').first().click();
    await expect(page).toHaveURL(/\/buildings\/c[a-z0-9]+/);

    await page.getByRole('button', { name: 'Add unit' }).click();
    await dialog(page).getByLabel('Unit number').fill('KEEP-1');
    await dialog(page).getByLabel('Monthly rent').fill('25000');
    await dialog(page).getByRole('button', { name: 'Create unit' }).click();
    await expect(page.getByRole('dialog')).toBeHidden();

    await page.getByRole('button', { name: 'Delete' }).click();
    // The dialog says what will happen to the units, rather than "are you sure".
    await expect(page.getByText(/will not be deleted/)).toBeVisible();
    await page.getByRole('button', { name: 'Delete building' }).click();

    await expect(page).toHaveURL(/\/properties\/c[a-z0-9]+/);
    await page.getByRole('tab', { name: 'Units' }).click();
    await expect(row(page, 'KEEP-1').first()).toBeVisible();
    await expect(row(page, 'Direct').first()).toBeVisible();
  });

  test('a property with units cannot be deleted, and the dialog explains why', async ({ page }) => {
    await signUp(page, unique('Blocked'));

    await page.goto('/properties');
    await page.getByRole('button', { name: 'Add property' }).first().click();
    await dialog(page).getByLabel('Name').fill('Occupied Estate');
    await dialog(page).getByRole('button', { name: 'Create property' }).click();
    await expect(page.getByRole('dialog')).toBeHidden();

    await row(page, 'Occupied Estate').first().click();
    await page.getByRole('tab', { name: 'Units' }).click();
    await page.getByRole('button', { name: 'Add unit' }).click();
    await dialog(page).getByLabel('Unit number').fill('A1');
    await dialog(page).getByLabel('Monthly rent').fill('20000');
    await dialog(page).getByRole('button', { name: 'Create unit' }).click();
    await expect(page.getByRole('dialog')).toBeHidden();

    await page.getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByText(/cannot be deleted. Archive it instead/)).toBeVisible();
  });
});
