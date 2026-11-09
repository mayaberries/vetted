import {describe, expect, it} from 'vitest';
import {createServicesStore} from '../../src/stores/services';
import {aService, createFakeApi} from './fakeApi';

/**
 * Mirrors tests/wip/services.spec.ts (list / create / edit / delete) at the
 * store level. The Playwright spec stays in wip/ for the UI pass.
 */
describe('services store', () => {
    const twoServices = () =>
        createFakeApi({
            'services.list': () => [
                aService({id: 'svc-2', name: 'Nail Trim', price: 20}),
                aService({id: 'svc-1', name: 'Wellness Exam', price: 65}),
            ],
        });

    it('lists the clinic services', async () => {
        const store = createServicesStore(twoServices());
        await store.load();

        expect(store.$items.get()).toHaveLength(2);
        expect(store.$byId.get()['svc-1']?.name).toBe('Wellness Exam');
    });

    it('sorts alphabetically and puts unnamed services last instead of crashing', async () => {
        const store = createServicesStore(
            createFakeApi({
                'services.list': () => [
                    aService({id: 'c', name: null}),
                    aService({id: 'b', name: 'Beta'}),
                    aService({id: 'a', name: 'Alpha'}),
                ],
            })
        );
        await store.load();

        expect(store.$sorted.get().map((s) => s.id)).toEqual(['a', 'b', 'c']);
    });

    it('adds a created service to the collection', async () => {
        const store = createServicesStore(twoServices());
        await store.load();

        const created = await store.create({
            name: 'Dental Cleaning',
            category: 'dental_cleaning',
            price: 120,
            duration_minutes: 45,
        });

        expect(created.name).toBe('Dental Cleaning');
        expect(store.findById(created.id)?.name).toBe('Dental Cleaning');
        expect(store.$items.get()).toHaveLength(3);
    });

    it('replaces the edited service in place rather than appending', async () => {
        const store = createServicesStore(twoServices());
        await store.load();

        await store.update('svc-1', {price: 150});

        expect(store.$items.get()).toHaveLength(2);
        expect(store.findById('svc-1')?.price).toBe(150);
    });

    it('removes a deleted service', async () => {
        const store = createServicesStore(twoServices());
        await store.load();

        await store.remove('svc-1');

        expect(store.findById('svc-1')).toBeUndefined();
        expect(store.$items.get()).toHaveLength(1);
    });

    it('does not remove anything when the delete is rejected', async () => {
        const store = createServicesStore(
            createFakeApi({
                'services.list': () => [aService({id: 'svc-1'})],
                'services.remove': () => {
                    throw new Error('Service has appointments.');
                },
            })
        );
        await store.load();

        await expect(store.remove('svc-1')).rejects.toThrow('Service has appointments.');
        expect(store.findById('svc-1')).toBeDefined();
    });
});
