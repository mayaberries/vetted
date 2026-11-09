import {describe, expect, it, vi} from 'vitest';
import {createAppointmentsStore} from '../../src/stores/appointments';
import {anAppointment, aService, createFakeApi} from './fakeApi';

/**
 * Mirrors the acceptance criteria in tests/wip/appointments.spec.ts — listing
 * across every service, filtering by status, confirming, cancelling — at the
 * store level. The Playwright spec stays in wip/ to cover the same ground
 * through the real UI once the page exists.
 */

function twoServiceApi(overrides: Record<string, any> = {}) {
    return createFakeApi({
        'services.list': () => [aService({id: 'svc-1'}), aService({id: 'svc-2', name: 'Nail Trim'})],
        'appointments.listForService': (serviceId: string) =>
            serviceId === 'svc-1'
                ? [
                      anAppointment({id: 'a1', service_id: 'svc-1', status: 'requested', start_time: '2026-09-01T15:00:00Z'}),
                      anAppointment({id: 'a2', service_id: 'svc-1', status: 'cancelled', start_time: '2026-09-03T15:00:00Z'}),
                  ]
                : [anAppointment({id: 'b1', service_id: 'svc-2', status: 'confirmed', start_time: '2026-09-02T15:00:00Z'})],
        ...overrides,
    });
}

describe('appointments store', () => {
    it('fans out across every service and merges the results', async () => {
        const api = twoServiceApi();
        const store = createAppointmentsStore(api);

        await store.load();

        expect(store.$items.get().map((a) => a.id).sort()).toEqual(['a1', 'a2', 'b1']);
        expect(api.calls.filter((c) => c === 'appointments.listForService')).toHaveLength(2);
        expect(store.$partialFailure.get()).toBeNull();
    });

    it('sorts soonest-first, because the admin list is a worklist', async () => {
        const store = createAppointmentsStore(twoServiceApi());
        await store.load();

        expect(store.$sorted.get().map((a) => a.id)).toEqual(['a1', 'b1', 'a2']);
    });

    it('filters by status and counts each status', async () => {
        const store = createAppointmentsStore(twoServiceApi());
        await store.load();

        expect(store.$visible.get().map((a) => a.id)).toEqual(['a1', 'b1', 'a2']);

        store.setStatusFilter('requested');
        expect(store.$visible.get().map((a) => a.id)).toEqual(['a1']);
        expect(store.$visible.get().some((a) => a.status === 'cancelled')).toBe(false);

        expect(store.$counts.get()).toEqual({requested: 1, cancelled: 1, confirmed: 1});
        expect(store.$awaitingConfirmation.get().map((a) => a.id)).toEqual(['a1']);
    });

    it('keeps what loaded when one service fails, and says which one', async () => {
        const store = createAppointmentsStore(
            twoServiceApi({
                'appointments.listForService': (serviceId: string) => {
                    if (serviceId === 'svc-2') throw new Error('boom');
                    return [anAppointment({id: 'a1', service_id: 'svc-1'})];
                },
            })
        );

        await store.load();

        expect(store.$state.get()).toBe('ready');
        expect(store.$items.get().map((a) => a.id)).toEqual(['a1']);
        expect(store.$partialFailure.get()).toMatch(/Nail Trim/);
    });

    it('treats a total fan-out failure as a real error, not a partial one', async () => {
        const store = createAppointmentsStore(
            twoServiceApi({
                'appointments.listForService': () => {
                    throw new Error('backend down');
                },
            })
        );

        await store.load();

        expect(store.$state.get()).toBe('error');
        expect(store.$error.get()).toBe('backend down');
    });

    it('confirms an appointment using the service id it looks up locally', async () => {
        const api = twoServiceApi();
        const confirm = vi.fn((_serviceId: string, id: string) =>
            anAppointment({id, service_id: 'svc-1', status: 'confirmed'})
        );
        const store = createAppointmentsStore(
            twoServiceApi({'appointments.confirm': confirm})
        );
        await store.load();

        await store.confirm('a1');

        expect(confirm).toHaveBeenCalledWith('svc-1', 'a1');
        expect(store.findById('a1')?.status).toBe('confirmed');
        expect(api.calls).not.toContain('appointments.cancel');
    });

    it('cancels in place, but withdraw removes the row entirely', async () => {
        const store = createAppointmentsStore(twoServiceApi());
        await store.load();

        await store.cancel('a1');
        expect(store.findById('a1')?.status).toBe('cancelled');

        await store.withdraw('a1');
        expect(store.findById('a1')).toBeUndefined();
    });

    it('passes the cancellation reason through to the API and stores it', async () => {
        const cancel = vi.fn((_s: string, id: string, reason?: string | null) =>
            anAppointment({id, status: 'cancelled', cancellation_reason: reason ?? null})
        );
        const store = createAppointmentsStore(twoServiceApi({'appointments.cancel': cancel}));
        await store.load();

        await store.cancel('a1', 'Clinic closed that day');

        expect(cancel).toHaveBeenCalledWith('svc-1', 'a1', 'Clinic closed that day');
        expect(store.findById('a1')?.cancellation_reason).toBe('Clinic closed that day');
    });

    it('cancels without a reason when none is given', async () => {
        const cancel = vi.fn((_s: string, id: string, reason?: string | null) =>
            anAppointment({id, status: 'cancelled', cancellation_reason: reason ?? null})
        );
        const store = createAppointmentsStore(twoServiceApi({'appointments.cancel': cancel}));
        await store.load();

        await store.cancel('a1');

        expect(cancel).toHaveBeenCalledWith('svc-1', 'a1', undefined);
        expect(store.findById('a1')?.cancellation_reason).toBeNull();
    });

    it('reflects a declined result when the backend declines a requested appointment', async () => {
        // Cancelling something never confirmed declines it instead. The backend
        // decides, so the store must take the returned status rather than
        // assuming "cancelled".
        const store = createAppointmentsStore(
            twoServiceApi({
                'appointments.cancel': (_s: string, id: string, reason?: string | null) =>
                    anAppointment({id, status: 'declined', cancellation_reason: reason ?? null}),
            })
        );
        await store.load();

        await store.cancel('a1', 'Fully booked');

        expect(store.findById('a1')?.status).toBe('declined');
        expect(store.$counts.get().declined).toBe(1);

        store.setStatusFilter('declined');
        expect(store.$visible.get().map((a) => a.id)).toEqual(['a1']);
    });

    it('refuses to act on an appointment that was never loaded', async () => {
        const store = createAppointmentsStore(twoServiceApi());
        await store.load();

        await expect(store.confirm('nope')).rejects.toThrow(/isn't loaded/);
    });

    it('leaves the list untouched when a mutation is rejected', async () => {
        const store = createAppointmentsStore(
            twoServiceApi({
                'appointments.confirm': () => {
                    throw new Error('409 conflict');
                },
            })
        );
        await store.load();

        await expect(store.confirm('a1')).rejects.toThrow('409 conflict');
        expect(store.findById('a1')?.status).toBe('requested');
    });
});
