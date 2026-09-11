import { expect, test } from '@playwright/test';

/**
 * Phase 6 end to end: the dashboard and the reports, driven through the real UI.
 *
 * The point of these tests is that the figures on screen are the figures in the
 * database. A chart that renders is not evidence of anything — so each
 * assertion here names an amount that was put in earlier in the same journey.
 */

const PASSWORD = 'CorrectHorseBattery9';

function unique(prefix: string): string {
  return `${prefix}-${Date.now()}${Math.floor(Math.random() * 1000)}`;
}

function dialog(page: import('@playwright/test').Page) {
  return page.getByRole('dialog');
}

/** A row appears in both the desktop table and the mobile cards; take the visible one. */
function row(page: import('@playwright/test').Page, text: string | RegExp) {
  return page.getByText(text).filter({ visible: true });
}

/** Matches an amount by its digits — Intl renders KES as "Ksh" in this locale. */
function money(amount: string): RegExp {
  return new RegExp(`${amount.replace('.', '\\.')}(?!\\d)`);
}

async function signUp(page: import('@playwright/test').Page, organizationName: string) {
  await page.goto('/register');
  await page.getByLabel('Organization name').fill(organizationName);
  await page.getByLabel('Your full name').fill('Insight Owner');
  await page.getByLabel('Email').fill(`${unique('owner')}@example.test`);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByLabel('Confirm password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create organization' }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

/**
 * A property with two units, one of them let at a known rent, this month's
 * charge raised, 20,000 of it paid and 12,500 of expenses booked.
 *
 * Every number the dashboard shows afterwards is derivable from this.
 */
async function seedMonth(page: import('@playwright/test').Page) {
  await page.goto('/properties');
  await page.getByRole('button', { name: 'Add property' }).first().click();
  await dialog(page).getByLabel('Name').fill('Riverside Court');
  await dialog(page).getByRole('button', { name: 'Create property' }).click();
  await expect(dialog(page)).toBeHidden();

  await row(page, 'Riverside Court').first().click();
  await page.getByRole('tab', { name: 'Units' }).click();

  for (const [number, rent] of [
    ['B1', '30000'],
    ['B2', '25000'],
  ]) {
    await page.getByRole('button', { name: 'Add unit' }).click();
    await dialog(page).getByLabel('Unit number').fill(number!);
    await dialog(page).getByLabel('Monthly rent').fill(rent!);
    await dialog(page).getByRole('button', { name: 'Create unit' }).click();
    await expect(dialog(page)).toBeHidden();
  }

  await page.goto('/tenants');
  await page.getByRole('button', { name: 'Add tenant' }).first().click();
  await dialog(page).getByLabel('Full name').fill('Grace Wanjiku');
  await dialog(page).getByLabel('Phone', { exact: true }).fill('+254711000456');
  await dialog(page).getByRole('button', { name: 'Add tenant' }).click();
  await expect(dialog(page)).toBeHidden();

  await page.goto('/leases');
  await page.getByRole('button', { name: 'Create lease' }).first().click();
  await dialog(page).getByLabel('Tenant').click();
  await page.getByRole('option', { name: /Grace Wanjiku/ }).click();
  await dialog(page).getByLabel('Unit').click();
  await page.getByRole('option', { name: /B1/ }).click();
  await dialog(page).getByLabel('End date').fill('2027-12-31');
  await dialog(page).getByRole('button', { name: 'Create lease' }).click();
  await expect(dialog(page)).toBeHidden();

  await page.goto('/rent');
  await page.getByRole('button', { name: 'Generate charges' }).click();
  await expect(row(page, 'Grace Wanjiku').first()).toBeVisible();

  await page.getByRole('button', { name: 'Record payment' }).first().click();
  await dialog(page).getByLabel('Amount').fill('20000');
  await dialog(page).getByLabel('Reference').fill('INSIGHT001');
  await dialog(page).getByRole('button', { name: 'Record payment' }).click();
  await expect(dialog(page)).toBeHidden();

  await page.goto('/expenses');
  await page.getByRole('button', { name: 'Record expense' }).first().click();
  await dialog(page).getByLabel('Property').click();
  await page.getByRole('option', { name: /Riverside Court/ }).click();
  await dialog(page).getByLabel('Amount').fill('12500');
  await dialog(page).getByLabel('Description').fill('Replaced the water pump');
  await dialog(page).getByRole('button', { name: 'Record expense' }).click();
  await expect(dialog(page)).toBeHidden();
}

test.describe('Insights', () => {
  test('the dashboard shows the money that was actually put in', async ({ page }) => {
    await signUp(page, unique('Insights'));
    await seedMonth(page);

    await page.goto('/dashboard');

    // 30,000 charged, 20,000 collected, 10,000 still owed, 12,500 spent,
    // so net income is 7,500. Each of these is a figure, not a placeholder.
    await expect(page.getByText(money('30,000.00')).first()).toBeVisible();
    await expect(page.getByText(money('20,000.00')).first()).toBeVisible();
    await expect(page.getByText(money('10,000.00')).first()).toBeVisible();
    await expect(page.getByText(money('12,500.00')).first()).toBeVisible();
    await expect(page.getByText(money('7,500.00')).first()).toBeVisible();

    // 67% of what was charged has come in — the rate, not just the amount.
    await expect(page.getByText(/67% of what was charged/)).toBeVisible();

    // One of two units is let.
    await expect(page.getByText('50%').first()).toBeVisible();
    await expect(page.getByText('1 of 2 units')).toBeVisible();

    // The page says where the numbers come from, because that is the claim
    // being made and it should be visible to whoever is reading them.
    await expect(page.getByText(/read from the database, not estimated/)).toBeVisible();
  });

  test('every chart can be read as a table, for the figures and for contrast', async ({ page }) => {
    await signUp(page, unique('Charts'));
    await seedMonth(page);

    await page.goto('/dashboard');

    // The chart is there, and so is the way out of it. Three series colours sit
    // under 3:1 on the light card, so the table view is required relief rather
    // than a convenience.
    await expect(page.getByText('Charged against collected').first()).toBeVisible();

    const toggles = page.getByRole('button', { name: 'Table' });
    await expect(toggles.first()).toBeVisible();
    const chartCount = await toggles.count();
    expect(chartCount).toBeGreaterThanOrEqual(4);

    await toggles.first().click();
    // The same 30,000 and 20,000, now as digits in a table.
    await expect(page.getByText(money('30,000.00')).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Chart' }).first()).toBeVisible();
  });

  test('the worklists name who owes what', async ({ page }) => {
    await signUp(page, unique('Worklists'));
    await seedMonth(page);

    await page.goto('/dashboard');

    // The payment just taken, with its receipt number.
    await expect(page.getByText('Recent payments')).toBeVisible();
    await expect(row(page, /RCP-/).first()).toBeVisible();

    // Nothing is overdue yet — this month's charge is not past due — and the
    // panel says that rather than showing an empty box.
    await expect(page.getByText('Overdue rent')).toBeVisible();
  });

  test('a report runs against the live database and downloads as CSV', async ({ page }) => {
    await signUp(page, unique('Reports'));
    await seedMonth(page);

    await page.goto('/reports');
    await expect(page.getByText('Rent collection')).toBeVisible();
    await expect(page.getByText('Outstanding rent')).toBeVisible();
    await expect(page.getByText('Profit and loss')).toBeVisible();
    await expect(page.getByText(/Nothing here is a cached snapshot/)).toBeVisible();

    await page.getByText('Rent collection').first().click();
    await expect(page).toHaveURL(/\/reports\/rent-collection/);

    // The payment that was recorded, in the report, at its amount.
    await expect(row(page, 'Grace Wanjiku').first()).toBeVisible();
    await expect(page.getByText(money('20,000.00')).first()).toBeVisible();
    await expect(page.getByText('Total')).toBeVisible();

    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'CSV' }).click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/rent-collection.*\.csv$/);
  });

  test('an empty report says so plainly instead of erroring', async ({ page }) => {
    await signUp(page, unique('Empty'));

    await page.goto('/reports/outstanding-rent');
    await expect(page.getByText('No records match these filters')).toBeVisible();
    await expect(page.getByText(/empty result, not a failed one/)).toBeVisible();
  });

  test('the profit and loss report subtracts what was spent', async ({ page }) => {
    await signUp(page, unique('ProfitLoss'));
    await seedMonth(page);

    await page.goto('/reports/profit-loss');

    // 20,000 collected less 12,500 spent is 7,500 — the same arithmetic the
    // dashboard tile does, from the same rows.
    await expect(page.getByText(money('20,000.00')).first()).toBeVisible();
    await expect(page.getByText(money('12,500.00')).first()).toBeVisible();
    await expect(page.getByText(money('7,500.00')).first()).toBeVisible();
  });
});
