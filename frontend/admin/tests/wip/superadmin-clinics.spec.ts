import { test, expect } from '@playwright/test';

/**
 * ROADMAP — superadmin "Clinics" list. No page exists yet; src/pages/index.astro
 * currently says "Superadmin session — clinics list + site launch panel come next."
 *
 * Backend already supports the list (docs/openapi.json, tag "clinics"):
 *   GET /api/clinics/
 *
 * There's no dedicated "get one clinic's site-launch panel" endpoint yet —
 * that second test below is more speculative than the others in wip/ and may
 * need a new backend route, not just a new page.
 *
 * TODO — the data layer under this page now exists and is covered:
 *   - src/stores/clinics.ts              (list, $sorted, $bySlug)
 *   - tests/unit/clinicSettings.test.ts  ("clinics store (superadmin)")
 * What's left here is the UI pass: a real page wired to `clinicsStore`, and
 * these specs re-pointed at what it renders. Blocked on two things the store
 * can't supply:
 *   1. **No demo superadmin.** buildDemoUser() is always a clinic_admin, so
 *      these specs can't even sign in as someone who may reach /clinics. Add a
 *      demoSuperadminLogin action (src/actions/index.ts) first — it also closes
 *      the untested half of the role gate in tests/nav.spec.ts.
 *   2. The site-launch panel has no backend route at all; the store models
 *      clinics only. docs/proto/clinics.js shows the intended interaction.
 *
 * See docs/testing.md for how to graduate this spec once the page exists.
 */
test.describe.skip('Superadmin · Clinics', () => {
  test('lists every clinic on the platform', async ({ page }) => {
    await page.goto('/clinics');
    await expect(page.getByRole('heading', { name: 'Clinics' })).toBeVisible();
    await expect(page.getByRole('row')).not.toHaveCount(0);
  });

  test('links from a clinic row to its site-launch panel', async ({ page }) => {
    await page.goto('/clinics');
    await page.getByRole('row').first().getByRole('link', { name: /view/i }).click();

    await expect(page.getByRole('heading', { name: /site launch/i })).toBeVisible();
  });
});
