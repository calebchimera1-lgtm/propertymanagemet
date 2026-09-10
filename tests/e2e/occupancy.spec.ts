import { expect, test } from '@playwright/test';

/**
 * Phase 3 workflow end to end: a tenant is recorded, moved into a vacant unit,
 * and the unit's status follows. Then the lease is ended and the unit is
 * released.
 *
 * Runs on desktop and mobile.
 */

const PASSWORD = 'CorrectHorseBattery9';

function unique(prefix: string): string {
  return `${prefix}-${Date.now()}${Math.floor(Math.random() * 1000)}`;
}

function dialog(page: import('@playwright/test').Page) {
  return page.getByRole('dialog');
}

/** A row appears in both the desktop table and the mobile cards; take the visible one. */
function row(page: import('@playwright/test').Page, text: string) {
  return page.getByText(text).filter({ visible: true });
}

async function signUp(page: import('@playwright/test').Page, organizationName: string) {
  await page.goto('/register');
  await page.getByLabel('Organization name').fill(organizationName);
  await page.getByLabel('Your full name').fill('Occupancy Owner');
  await page.getByLabel('Email').fill(`${unique('owner')}@example.test`);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByLabel('Confirm password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create organization' }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

/** A property with one vacant unit, ready to lease. */
async function seedUnit(page: import('@playwright/test').Page, unitNumber: string, rent = '32000') {
  await page.goto('/properties');
  await page.getByRole('button', { name: 'Add property' }).first().click();
  await dialog(page).getByLabel('Name').fill('Sunrise Estate');
  await dialog(page).getByRole('button', { name: 'Create property' }).click();
  await expect(dialog(page)).toBeHidden();

  await row(page, 'Sunrise Estate').first().click();
  await page.getByRole('tab', { name: 'Units' }).click();
  await page.getByRole('button', { name: 'Add unit' }).click();
  await dialog(page).getByLabel('Unit number').fill(unitNumber);
  await dialog(page).getByLabel('Monthly rent').fill(rent);
  await dialog(page).getByRole('button', { name: 'Create unit' }).click();
  await expect(dialog(page)).toBeHidden();
}

async function addTenant(page: import('@playwright/test').Page, fullName: string) {
  await page.goto('/tenants');
  await page.getByRole('button', { name: 'Add tenant' }).first().click();
  await dialog(page).getByLabel('Full name').fill(fullName);
  await dialog(page).getByLabel('Phone', { exact: true }).fill('+254711000123');
  await dialog(page).getByRole('button', { name: 'Add tenant' }).click();
  await expect(dialog(page)).toBeHidden();
}

test.describe('Occupancy', () => {
  test('moving a tenant in occupies the unit; moving them out releases it', async ({ page }) => {
    await signUp(page, unique('Occupancy'));
    await seedUnit(page, 'A1');
    await addTenant(page, 'Grace Wanjiku');

    // The tenant is on file but not housed yet — stated, not implied.
    await expect(row(page, 'Not housed').first()).toBeVisible();

    await row(page, 'Grace Wanjiku').first().click();
    await expect(page).toHaveURL(/\/tenants\/c[a-z0-9]+/);

    await page.getByRole('button', { name: 'Create lease' }).first().click();
    await dialog(page).getByLabel('Unit').click();
    await page.getByRole('option', { name: /A1/ }).click();
    await dialog(page).getByLabel('End date').fill('2027-12-31');
    await dialog(page).getByRole('button', { name: 'Create lease' }).click();
    await expect(dialog(page)).toBeHidden();

    // The unit's status followed the lease, in the same step.
    await page.goto('/units');
    await expect(row(page, 'Occupied').first()).toBeVisible();

    // Ending the lease releases the unit again.
    await page.goto('/leases');
    await row(page, 'Grace Wanjiku').first().click();
    await expect(page).toHaveURL(/\/leases\/c[a-z0-9]+/);

    await page.getByRole('button', { name: 'End lease' }).click();
    await expect(dialog(page).getByText(/never deleted/)).toBeVisible();
    await dialog(page).getByRole('button', { name: 'End lease' }).click();
    await expect(dialog(page)).toBeHidden();

    await expect(row(page, 'Terminated').first()).toBeVisible();

    await page.goto('/units');
    await expect(row(page, 'Vacant').first()).toBeVisible();
  });

  test('a unit cannot be double-let: once leased it leaves the picker', async ({ page }) => {
    await signUp(page, unique('DoubleLet'));
    await seedUnit(page, 'ONLY-1');
    await addTenant(page, 'First Tenant');
    await addTenant(page, 'Second Tenant');

    await page.goto('/leases');
    await page.getByRole('button', { name: 'Create lease' }).first().click();
    await dialog(page).getByLabel('Tenant').click();
    await page.getByRole('option', { name: /First Tenant/ }).click();
    await dialog(page).getByLabel('Unit').click();
    await page.getByRole('option', { name: /ONLY-1/ }).click();
    await dialog(page).getByRole('button', { name: 'Create lease' }).click();
    await expect(dialog(page)).toBeHidden();

    // The only unit is now occupied, so there is nothing left to lease — the
    // form says so rather than offering a choice the API would reject.
    await page.getByRole('button', { name: 'Create lease' }).first().click();
    await expect(dialog(page).getByText(/no vacant units/i)).toBeVisible();
  });

  test('a lease past its end date is flagged but keeps the unit', async ({ page }) => {
    await signUp(page, unique('Expiry'));
    await seedUnit(page, 'EXP-1');
    await addTenant(page, 'Holdover Tenant');

    await page.goto('/leases');
    await page.getByRole('button', { name: 'Create lease' }).first().click();
    await dialog(page).getByLabel('Tenant').click();
    await page.getByRole('option', { name: /Holdover Tenant/ }).click();
    await dialog(page).getByLabel('Unit').click();
    await page.getByRole('option', { name: /EXP-1/ }).click();

    // A lease that starts and ends in the past.
    await dialog(page).getByLabel('Start date').fill('2020-01-01');
    await dialog(page).getByLabel('End date').fill('2021-01-01');
    await dialog(page).getByRole('button', { name: 'Create lease' }).click();
    await expect(dialog(page)).toBeHidden();

    await row(page, 'Holdover Tenant').first().click();
    await expect(page.getByText(/Ended \d+ days ago/).first()).toBeVisible();

    // The unit is still occupied: a tenant staying past the end date is normal.
    await page.goto('/units');
    await expect(row(page, 'Occupied').first()).toBeVisible();
  });

  test('renewing extends the term and can review the rent', async ({ page }) => {
    await signUp(page, unique('Renewal'));
    await seedUnit(page, 'REN-1', '30000');
    await addTenant(page, 'Renewing Tenant');

    await page.goto('/leases');
    await page.getByRole('button', { name: 'Create lease' }).first().click();
    await dialog(page).getByLabel('Tenant').click();
    await page.getByRole('option', { name: /Renewing Tenant/ }).click();
    await dialog(page).getByLabel('Unit').click();
    await page.getByRole('option', { name: /REN-1/ }).click();
    await dialog(page).getByLabel('End date').fill('2027-01-31');
    await dialog(page).getByRole('button', { name: 'Create lease' }).click();
    await expect(dialog(page)).toBeHidden();

    await row(page, 'Renewing Tenant').first().click();
    await expect(page.getByText(/30,000\.00/).filter({ visible: true }).first()).toBeVisible();

    await page.getByRole('button', { name: 'Renew' }).click();
    await dialog(page).getByLabel('New end date').fill('2029-01-31');
    await dialog(page).getByLabel('New monthly rent').fill('35000');
    await dialog(page).getByRole('button', { name: 'Renew lease' }).click();
    await expect(dialog(page)).toBeHidden();

    await expect(page.getByText(/35,000\.00/).filter({ visible: true }).first()).toBeVisible();
  });

  test('a tenant with lease history cannot be deleted, and the dialog explains why', async ({
    page,
  }) => {
    await signUp(page, unique('History'));
    await seedUnit(page, 'HIST-1');
    await addTenant(page, 'Historic Tenant');

    await page.goto('/leases');
    await page.getByRole('button', { name: 'Create lease' }).first().click();
    await dialog(page).getByLabel('Tenant').click();
    await page.getByRole('option', { name: /Historic Tenant/ }).click();
    await dialog(page).getByLabel('Unit').click();
    await page.getByRole('option', { name: /HIST-1/ }).click();
    await dialog(page).getByRole('button', { name: 'Create lease' }).click();
    await expect(dialog(page)).toBeHidden();

    await page.goto('/tenants');
    await row(page, 'Historic Tenant').first().click();
    await page.getByRole('button', { name: 'Delete' }).click();

    await expect(page.getByText(/cannot be deleted. Deactivate them instead/)).toBeVisible();
  });

  test('the tenant profile names the finance section as not built rather than showing zeroes', async ({
    page,
  }) => {
    await signUp(page, unique('Honest'));
    await addTenant(page, 'Honest Tenant');

    await page.goto('/tenants');
    await row(page, 'Honest Tenant').first().click();
    await expect(page.getByText('Rent and payments arrive in Phase 4.')).toBeVisible();
  });
});
