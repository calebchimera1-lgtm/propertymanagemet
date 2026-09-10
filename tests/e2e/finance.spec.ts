import { expect, test } from '@playwright/test';

/**
 * Phase 4 workflow end to end: rent is charged, a payment is taken, a receipt
 * is issued, the payment is reversed, and an expense is booked.
 *
 * This is the journey the money actually takes through the product, driven
 * through the real UI against the real API. Runs on desktop and mobile.
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

/**
 * Matches an amount by its digits, not its currency symbol.
 *
 * Intl renders KES as "Ksh" in this locale, and asserting on the symbol would
 * make these tests fail on an ICU upgrade rather than on a real regression.
 */
function money(amount: string): RegExp {
  return new RegExp(`${amount.replace('.', '\\.')}(?!\\d)`);
}

async function signUp(page: import('@playwright/test').Page, organizationName: string) {
  await page.goto('/register');
  await page.getByLabel('Organization name').fill(organizationName);
  await page.getByLabel('Your full name').fill('Finance Owner');
  await page.getByLabel('Email').fill(`${unique('owner')}@example.test`);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByLabel('Confirm password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create organization' }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

/** A tenant housed in a unit at a known rent — everything rent needs to exist. */
async function seedTenancy(page: import('@playwright/test').Page) {
  await page.goto('/properties');
  await page.getByRole('button', { name: 'Add property' }).first().click();
  await dialog(page).getByLabel('Name').fill('Sunrise Estate');
  await dialog(page).getByRole('button', { name: 'Create property' }).click();
  await expect(dialog(page)).toBeHidden();

  await row(page, 'Sunrise Estate').first().click();
  await page.getByRole('tab', { name: 'Units' }).click();
  await page.getByRole('button', { name: 'Add unit' }).click();
  await dialog(page).getByLabel('Unit number').fill('A1');
  await dialog(page).getByLabel('Monthly rent').fill('30000');
  await dialog(page).getByRole('button', { name: 'Create unit' }).click();
  await expect(dialog(page)).toBeHidden();

  await page.goto('/tenants');
  await page.getByRole('button', { name: 'Add tenant' }).first().click();
  await dialog(page).getByLabel('Full name').fill('Grace Wanjiku');
  await dialog(page).getByLabel('Phone', { exact: true }).fill('+254711000123');
  await dialog(page).getByRole('button', { name: 'Add tenant' }).click();
  await expect(dialog(page)).toBeHidden();

  await page.goto('/leases');
  await page.getByRole('button', { name: 'Create lease' }).first().click();
  await dialog(page).getByLabel('Tenant').click();
  await page.getByRole('option', { name: /Grace Wanjiku/ }).click();
  await dialog(page).getByLabel('Unit').click();
  await page.getByRole('option', { name: /A1/ }).click();
  await dialog(page).getByLabel('End date').fill('2027-12-31');
  await dialog(page).getByRole('button', { name: 'Create lease' }).click();
  await expect(dialog(page)).toBeHidden();
}

/** Generates this month's charges from the rent screen. */
async function generateCharges(page: import('@playwright/test').Page) {
  await page.goto('/rent');
  await page.getByRole('button', { name: 'Generate charges' }).click();
  await expect(row(page, 'Grace Wanjiku').first()).toBeVisible();
}

test.describe('Finance', () => {
  test('charging rent, taking a payment and issuing a receipt', async ({ page }) => {
    await signUp(page, unique('Finance'));
    await seedTenancy(page);

    // Nothing has been charged yet, and the screen says so rather than showing
    // an empty table that could be mistaken for "everyone has paid".
    await page.goto('/rent');
    await expect(row(page, /No charges for/).first()).toBeVisible();

    await generateCharges(page);
    await expect(row(page, money('30,000.00')).first()).toBeVisible();

    // Running it again is safe — the message says what happened rather than
    // pretending new charges were made.
    await page.getByRole('button', { name: 'Generate charges' }).click();
    await expect(page.getByText(/Already generated/)).toBeVisible();

    await page.getByRole('button', { name: 'Record payment' }).first().click();
    await expect(dialog(page).getByText('Still owing', { exact: true })).toBeVisible();
    // The amount defaults to settling the charge in full; this is a part payment.
    await dialog(page).getByLabel('Amount').fill('10000');
    await dialog(page).getByLabel('Reference').fill('SJK4H7X9QP');
    await dialog(page).getByRole('button', { name: 'Record payment' }).click();
    await expect(dialog(page)).toBeHidden();

    // The receipt number comes back in the confirmation, not on a later screen.
    await expect(page.getByText(/Receipt RCP-/)).toBeVisible();

    // The rent roll reflects the payment: part paid, and 20,000 still owing.
    await expect(row(page, money('20,000.00')).first()).toBeVisible();

    // The same money, from the receipt book.
    await page.goto('/receipts');
    await row(page, /RCP-/).first().click();
    await expect(page).toHaveURL(/\/receipts\/c[a-z0-9]+/);
    await expect(page.getByText('Received from')).toBeVisible();
    await expect(page.getByText('Grace Wanjiku')).toBeVisible();
    await expect(page.getByText(money('10,000.00'))).toBeVisible();
    await expect(page.getByRole('button', { name: 'Print' })).toBeVisible();
  });

  test('a duplicate M-Pesa code is refused, naming the receipt that already used it', async ({
    page,
  }) => {
    await signUp(page, unique('Duplicate'));
    await seedTenancy(page);
    await generateCharges(page);

    for (const attempt of [1, 2]) {
      await page.getByRole('button', { name: 'Record payment' }).first().click();
      await dialog(page).getByLabel('Amount').fill('5000');
      await dialog(page).getByLabel('Reference').fill('SAMECODE99');
      await dialog(page).getByRole('button', { name: 'Record payment' }).click();

      if (attempt === 1) {
        await expect(dialog(page)).toBeHidden();
      } else {
        // The dialog stays open with the error attached to the Reference
        // field, naming the receipt that already used the code — so it can be
        // corrected rather than the payment being lost.
        await expect(dialog(page).getByText(/Already used on receipt RCP-/)).toBeVisible();
        await dialog(page).getByRole('button', { name: 'Cancel' }).click();
      }
    }

    await page.goto('/payments');
    await expect(page.getByText(money('5,000.00')).first()).toBeVisible();
  });

  test('voiding a payment puts the balance back and marks the receipt void', async ({ page }) => {
    await signUp(page, unique('Void'));
    await seedTenancy(page);
    await generateCharges(page);

    await page.getByRole('button', { name: 'Record payment' }).first().click();
    await dialog(page).getByLabel('Reference').fill('VOIDME01');
    await dialog(page).getByRole('button', { name: 'Record payment' }).click();
    await expect(dialog(page)).toBeHidden();

    // Paid in full: the row no longer offers to take more money.
    await expect(page.getByRole('button', { name: 'Record payment' })).toHaveCount(0);

    await page.goto('/payments');
    await page.getByRole('button', { name: 'Void' }).first().click();
    await expect(dialog(page).getByText(/keeps its number/)).toBeVisible();
    await dialog(page).getByLabel('Reason').fill('Bank reversed the transfer');
    await dialog(page).getByRole('button', { name: 'Void payment' }).click();
    await expect(dialog(page)).toBeHidden();

    // The payment is still there, marked void — not deleted.
    await expect(row(page, 'Voided').first()).toBeVisible();

    // And the charge is owed again.
    await page.goto('/rent');
    await expect(row(page, money('30,000.00')).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Record payment' }).first()).toBeVisible();
  });

  test('recording an expense adds it to the total spent', async ({ page }) => {
    await signUp(page, unique('Expenses'));
    await seedTenancy(page);

    await page.goto('/expenses');
    await expect(row(page, 'No expenses recorded').first()).toBeVisible();

    await page.getByRole('button', { name: 'Record expense' }).first().click();
    await dialog(page).getByLabel('Property').click();
    await page.getByRole('option', { name: /Sunrise Estate/ }).click();
    await dialog(page).getByLabel('Amount').fill('12500');
    await dialog(page).getByLabel('Description').fill('Replaced the water pump');
    await dialog(page).getByRole('button', { name: 'Record expense' }).click();
    await expect(dialog(page)).toBeHidden();

    await expect(row(page, 'Replaced the water pump').first()).toBeVisible();
    await expect(page.getByText(money('12,500.00')).first()).toBeVisible();

    // An amount of nothing is a mistake, and it is caught at the input rather
    // than by a constraint violation from the database.
    await page.getByRole('button', { name: 'Record expense' }).first().click();
    await dialog(page).getByLabel('Property').click();
    await page.getByRole('option', { name: /Sunrise Estate/ }).click();
    await dialog(page).getByLabel('Amount').fill('0');
    await dialog(page).getByLabel('Description').fill('Nothing at all');
    await dialog(page).getByRole('button', { name: 'Record expense' }).click();
    await expect(dialog(page).getByText(/above zero/)).toBeVisible();
  });

  test('the tenant profile shows what has been charged and paid', async ({ page }) => {
    await signUp(page, unique('Profile'));
    await seedTenancy(page);
    await generateCharges(page);

    await page.getByRole('button', { name: 'Record payment' }).first().click();
    await dialog(page).getByLabel('Amount').fill('12000');
    await dialog(page).getByRole('button', { name: 'Record payment' }).click();
    await expect(dialog(page)).toBeHidden();

    await page.goto('/tenants');
    await row(page, 'Grace Wanjiku').first().click();
    await expect(page.getByText('Charged to date')).toBeVisible();
    await expect(page.getByText(money('18,000.00')).first()).toBeVisible();

    await page.getByRole('tab', { name: 'Rent & payments' }).click();
    await expect(page.getByText('Recent payments')).toBeVisible();
    await expect(page.getByText(money('12,000.00')).first()).toBeVisible();
  });
});
