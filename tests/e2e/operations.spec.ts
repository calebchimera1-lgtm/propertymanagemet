import { expect, test } from '@playwright/test';

/**
 * Phase 5 workflow end to end: raise a job, move it through the workflow, file
 * a document against a record, invite staff and scope them.
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
function row(page: import('@playwright/test').Page, text: string | RegExp) {
  return page.getByText(text).filter({ visible: true });
}

async function signUp(page: import('@playwright/test').Page, organizationName: string) {
  await page.goto('/register');
  await page.getByLabel('Organization name').fill(organizationName);
  await page.getByLabel('Your full name').fill('Operations Owner');
  await page.getByLabel('Email').fill(`${unique('owner')}@example.test`);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByLabel('Confirm password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create organization' }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

/** A property with one unit — everything maintenance and documents hang off. */
async function seedProperty(page: import('@playwright/test').Page) {
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
}

async function raiseRequest(page: import('@playwright/test').Page, title: string) {
  await page.goto('/maintenance');
  await page.getByRole('button', { name: 'Raise request' }).first().click();
  await dialog(page).getByLabel('Property').click();
  await page.getByRole('option', { name: /Sunrise Estate/ }).click();
  await dialog(page).getByLabel('Title').fill(title);
  await dialog(page).getByLabel('Description').fill('Dripping constantly since Tuesday.');
  await dialog(page).getByRole('button', { name: 'Raise request' }).click();
  await expect(dialog(page)).toBeHidden();
}

test.describe('Operations', () => {
  test('a maintenance job goes from reported to done, with a timeline behind it', async ({
    page,
  }) => {
    await signUp(page, unique('Ops'));
    await seedProperty(page);

    await page.goto('/maintenance');
    await expect(row(page, 'Nothing reported').first()).toBeVisible();

    await raiseRequest(page, 'Kitchen tap will not close');
    await expect(row(page, 'Kitchen tap will not close').first()).toBeVisible();

    await row(page, 'Kitchen tap will not close').first().click();
    await expect(page).toHaveURL(/\/maintenance\/c[a-z0-9]+/);
    // Scoped to the page: the toast says the same words, and the timeline
    // entry is the one that matters here.
    await expect(page.getByRole('main').getByText('Request raised.')).toBeVisible();

    // A pending job cannot jump to completed — the button is not offered.
    await expect(page.getByRole('button', { name: 'Mark completed' })).toHaveCount(0);

    await page.getByRole('button', { name: 'Mark in progress' }).click();
    await dialog(page).getByLabel('Note').fill('Plumber on site.');
    await dialog(page).getByRole('button', { name: 'Mark in progress' }).click();
    await expect(dialog(page)).toBeHidden();

    await page.getByRole('button', { name: 'Mark completed' }).click();
    await expect(dialog(page).getByText(/Completed requests are final/)).toBeVisible();
    await dialog(page).getByLabel('Actual cost').fill('5200');
    await dialog(page).getByRole('button', { name: 'Mark completed' }).click();
    await expect(dialog(page)).toBeHidden();

    // Finished, and it says so rather than offering a reopen that would fail.
    await expect(page.getByText(/cannot be reopened or edited/)).toBeVisible();
    await expect(page.getByText('Plumber on site.')).toBeVisible();
    await expect(page.getByRole('button', { name: /^Mark / })).toHaveCount(0);
  });

  test('a document is filed against a property and can be downloaded back', async ({ page }) => {
    await signUp(page, unique('Docs'));
    await seedProperty(page);

    await page.goto('/documents');
    await expect(row(page, 'No documents yet').first()).toBeVisible();

    await page.getByRole('button', { name: 'Upload' }).first().click();
    await dialog(page)
      .getByLabel('File')
      .setInputFiles({
        name: 'lease.pdf',
        mimeType: 'application/pdf',
        buffer: Buffer.from('%PDF-1.7\nend-to-end fixture\n'),
      });
    await dialog(page).getByLabel('Belongs to').click();
    await page.getByRole('option', { name: 'Property', exact: true }).click();
    await dialog(page).getByLabel('Record').click();
    await page.getByRole('option', { name: /Sunrise Estate/ }).click();
    await dialog(page).getByLabel('Name').fill('Title deed');
    await dialog(page).getByRole('button', { name: 'Upload' }).click();
    await expect(dialog(page)).toBeHidden();

    await expect(row(page, 'Title deed').first()).toBeVisible();

    // The download goes through the API with the session cookie — there is no
    // public URL to click.
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download' }).first().click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('lease.pdf');
  });

  test('a file that is not what it claims to be is refused', async ({ page }) => {
    await signUp(page, unique('Evil'));
    await seedProperty(page);

    await page.goto('/documents');
    await page.getByRole('button', { name: 'Upload' }).first().click();
    await dialog(page)
      .getByLabel('File')
      .setInputFiles({
        name: 'invoice.pdf',
        mimeType: 'application/pdf',
        // Named .pdf, declared as a PDF, and neither is true.
        buffer: Buffer.from('<?php system($_GET["c"]); ?>'),
      });
    await dialog(page).getByRole('button', { name: 'Upload' }).click();

    await expect(dialog(page).getByText(/contents are not a pdf file/i)).toBeVisible();
  });

  test('inviting staff hands over a link, because no email is sent', async ({ page }) => {
    await signUp(page, unique('Staff'));
    await seedProperty(page);

    await page.goto('/staff');
    await expect(page.getByText(/Email is not delivered in this version/)).toBeVisible();

    await page.getByRole('button', { name: 'Invite staff' }).first().click();
    await dialog(page).getByLabel('Full name').fill('Peter Kamau');
    await dialog(page).getByLabel('Email').fill(`${unique('caretaker')}@example.test`);
    // Caretaker is the default role; the dialog says what that means.
    await expect(dialog(page).getByText(/see only the properties you assign/)).toBeVisible();
    await dialog(page).getByRole('button', { name: 'Create invite' }).click();

    // The link is shown once, with that stated plainly.
    await expect(dialog(page).getByText('Send them this link')).toBeVisible();
    await expect(dialog(page).getByText(/only time the link is shown/)).toBeVisible();
    await expect(dialog(page).getByLabel('Invite link')).toHaveValue(/\/reset-password\?token=/);
    await dialog(page).getByRole('button', { name: 'Done' }).click();
    await expect(dialog(page)).toBeHidden();

    await expect(row(page, 'Peter Kamau').first()).toBeVisible();
    await expect(row(page, 'Invited').first()).toBeVisible();
    // A scoped role with nothing assigned sees nothing, and the list says so.
    await expect(row(page, 'No properties assigned').first()).toBeVisible();

    await page.getByRole('button', { name: 'Properties' }).first().click();
    await expect(dialog(page).getByText(/Nothing is ticked/)).toBeVisible();
    await dialog(page).getByRole('checkbox').first().check();
    await dialog(page).getByRole('button', { name: 'Save assignments' }).click();
    await expect(dialog(page)).toBeHidden();

    await expect(row(page, '1 property').first()).toBeVisible();
  });

  test('the audit trail shows what happened and offers no way to change it', async ({ page }) => {
    await signUp(page, unique('Audit'));
    await seedProperty(page);
    await raiseRequest(page, 'Broken lock on the gate');

    await page.goto('/settings');
    await expect(page.getByText('Audit log')).toBeVisible();
    await expect(page.getByText(/nothing here can be edited or removed/i)).toBeVisible();
    await expect(row(page, 'Maintenance created').first()).toBeVisible();
    await expect(row(page, 'Property created').first()).toBeVisible();
  });
});
