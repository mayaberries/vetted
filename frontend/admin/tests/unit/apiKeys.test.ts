import {describe, expect, it} from 'vitest';
import {createApiKeysStore} from '../../src/stores/apiKeys';
import {anApiKey, createFakeApi} from './fakeApi';

/** Mirrors tests/wip/api-keys.spec.ts (list / issue / revoke) at the store level. */
describe('apiKeys store', () => {
    const bothKeys = () =>
        createFakeApi({
            'apiKeys.list': () => [
                anApiKey({id: 'key-1', label: 'Website widget', is_active: true}),
                anApiKey({
                    id: 'key-2',
                    label: 'Local testing',
                    environment: 'test',
                    public_key: 'pk_test_a1b2c3',
                    is_active: false,
                }),
            ],
        });

    it('splits keys into active and revoked', async () => {
        const store = createApiKeysStore(bothKeys());
        await store.load();

        expect(store.$active.get().map((k) => k.id)).toEqual(['key-1']);
        expect(store.$revoked.get().map((k) => k.id)).toEqual(['key-2']);
    });

    it('adds an issued key with its public_key exposed once', async () => {
        const store = createApiKeysStore(bothKeys());
        await store.load();

        const created = await store.create({label: 'Website widget', environment: 'live'});

        expect(created.public_key).toMatch(/^pk_(live|test)_/);
        expect(store.findById(created.id)?.label).toBe('Website widget');
    });

    it('revoking marks the key inactive but keeps it listed', async () => {
        // The clinic needs to see that a key was revoked and when — a key that
        // silently vanishes looks like data loss.
        const store = createApiKeysStore(bothKeys());
        await store.load();

        await store.revoke('key-1');

        expect(store.$items.get()).toHaveLength(2);
        expect(store.findById('key-1')?.is_active).toBe(false);
        expect(store.findById('key-1')?.revoked_at).toBeTruthy();
        expect(store.$active.get()).toHaveLength(0);
        expect(store.$revoked.get().map((k) => k.id).sort()).toEqual(['key-1', 'key-2']);
    });

    it('leaves the key active when the revoke is rejected', async () => {
        const store = createApiKeysStore(
            createFakeApi({
                'apiKeys.list': () => [anApiKey({id: 'key-1', is_active: true})],
                'apiKeys.revoke': () => {
                    throw new Error('Forbidden');
                },
            })
        );
        await store.load();

        await expect(store.revoke('key-1')).rejects.toThrow('Forbidden');
        expect(store.findById('key-1')?.is_active).toBe(true);
    });
});
