import { test, expect } from '@playwright/test';
import { existingAppointment } from './fixtures';

/**
 * ROADMAP — clinic admin "Appointments" tab. No page exists yet; src/pages/index.astro
 * currently says "real appointments/services/keys tabs come next."
 *
 * Backend already supports this in full (docs/openapi.json, tag "appointments"):
 *   GET    /api/services/{service_id}/appointments/                (list)
 *   GET    /api/services/{service_id}/appointments/{appointment_id}
 *   PUT    /api/services/{service_id}/appointments/{appointment_id}/confirm
 *   PUT    /api/services/{service_id}/appointments/{appointment_id}/cancel
 *   DELETE /api/services/{service_id}/appointments/{appointment_id}   (withdraw)
 *
 * The admin's own view is necessarily cross-service (an appointment list, not
 * a per-service one) — expect it to aggregate across every service's endpoint,
 * or for the backend to grow a clinic-wide listing route to back it.
 *
 * TODO — the data layer under this page now exists and is covered:
 *   - src/stores/appointments.ts       (the cross-service fan-out, status
 *                                       filter, confirm / cancel / withdraw)
 *   - tests/unit/appointments.test.ts  (the same cases, store level, including
 *                                       partial fan-out failure)
 * What's left here is the UI pass: a real page wired to `appointmentsStore`,
 * and these specs re-pointed at what it renders. Two gaps the store can't
 * settle on its own, worth resolving while building the page:
 *   1. `cancel` takes no reason — the spec below fills a /reason/ field, but
 *      PUT .../cancel has no body in openapi.json. Either drop the field or
 *      add it to the backend first.
 *   2. The fan-out is an N+1 over services. If the backend grows
 *      GET /api/clinics/{id}/appointments/, delete the fan-out in the store
 *      rather than working around it here.
 *
 * See docs/testing.md for how to graduate this spec once the page exists.
 */
test.describe.skip('Clinic admin · Appointments', () => {
  test('lists appointments across all services', async ({ page }) => {
    await page.goto('/appointments');
    await expect(page.getByRole('heading', { name: 'Appointments' })).toBeVisible();
    await expect(page.getByRole('row').filter({ hasText: existingAppointment.petName })).toBeVisible();
  });

  test('filters appointments by status', async ({ page }) => {
    await page.goto('/appointments');
    await page.getByLabel(/status/i).selectOption('requested');

    await expect(page.getByRole('row').filter({ hasText: /requested/i })).not.toHaveCount(0);
    await expect(page.getByRole('row').filter({ hasText: /cancelled/i })).toHaveCount(0);
  });

  test('confirms a requested appointment', async ({ page }) => {
    await page.goto('/appointments');
    const row = page.getByRole('row').filter({ hasText: existingAppointment.petName });

    await row.getByRole('button', { name: /confirm/i }).click();

    await expect(row.getByText(/confirmed/i)).toBeVisible();
  });

  test('cancels an appointment with a reason', async ({ page }) => {
    await page.goto('/appointments');
    const row = page.getByRole('row').filter({ hasText: existingAppointment.petName });

    await row.getByRole('button', { name: /cancel/i }).click();
    await page.getByLabel(/reason/i).fill('Clinic closed that day');
    await page.getByRole('button', { name: /confirm cancellation/i }).click();

    await expect(row.getByText(/cancelled/i)).toBeVisible();
  });
});
