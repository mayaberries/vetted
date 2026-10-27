import { test, expect } from '@playwright/test';
import { clinicProfileUpdate, mondayHours } from './fixtures';

/**
 * ROADMAP — clinic admin "Settings" pages: profile, staff, and hours. No page
 * exists yet for any of these.
 *
 * Backend already supports this in full (docs/openapi.json):
 *   GET/PUT  /api/clinics/{clinic_id}/                 (profile — tag "clinics")
 *   POST     /api/clinics/{clinic_id}/staff/join        (join as staff — tag "clinics")
 *   GET/PUT  /api/clinics/{clinic_id}/availability/     (weekly hours — tag "clinic-availability")
 *
 * TODO — the data layer under these pages now exists and is covered:
 *   - src/stores/clinicSettings.ts       (profile store + availability store)
 *   - tests/unit/clinicSettings.test.ts  (the same cases, store level)
 * What's left here is the UI pass: real pages wired to `clinicProfileStore` and
 * `availabilityStore`, and these specs re-pointed at what they render. Two
 * things to respect when building the hours editor:
 *   1. The availability PUT is a **full replace** — an omitted weekday means
 *      "closed", not "unchanged". The store already holds the whole week and
 *      sends all of it on save(); don't reintroduce a per-day patch.
 *   2. /settings/clinic, /settings/staff and /settings/hours have no route or
 *      nav entry yet. Add a "Settings" tab to src/lib/nav.ts first — tabForPath
 *      already prefix-matches, so nested routes resolve to their parent tab.
 *
 * See docs/testing.md for how to graduate this spec once the pages exist.
 */
test.describe.skip('Clinic admin · Settings', () => {
  test('shows and edits the clinic profile', async ({ page }) => {
    await page.goto('/settings/clinic');
    await expect(page.getByLabel(/clinic name/i)).toHaveValue(/.+/);

    await page.getByLabel(/address/i).fill(clinicProfileUpdate.address);
    await page.getByRole('button', { name: /save/i }).click();

    await expect(page.getByText(/saved/i)).toBeVisible();
  });

  test('lets a logged-in user join the clinic as staff', async ({ page }) => {
    await page.goto('/settings/staff');
    await page.getByRole('button', { name: /join this clinic/i }).click();

    await expect(page.getByText(/you.?re now staff/i)).toBeVisible();
  });

  test('edits the clinic’s weekly availability', async ({ page }) => {
    await page.goto('/settings/hours');
    const monday = page.getByRole('row', { name: 'Monday' });

    await monday.getByLabel(/start/i).fill(mondayHours.start);
    await monday.getByLabel(/end/i).fill(mondayHours.end);
    await page.getByRole('button', { name: /save hours/i }).click();

    await expect(page.getByText(/saved/i)).toBeVisible();
  });
});
