import {describe, expect, it, vi} from 'vitest';
import {createAsyncStore, createCollectionStore} from '../../src/stores/createAsyncStore';
import {deferred} from './fakeApi';

describe('createAsyncStore', () => {
    it('moves idle → loading → ready and exposes the data', async () => {
        const store = createAsyncStore(async () => 'hello', '');
        expect(store.$state.get()).toBe('idle');

        const inFlight = store.load();
        expect(store.$state.get()).toBe('loading');
        expect(store.$isLoading.get()).toBe(true);

        await inFlight;
        expect(store.$state.get()).toBe('ready');
        expect(store.$data.get()).toBe('hello');
        expect(store.$error.get()).toBeNull();
    });

    it('records a readable message on failure and keeps the previous data', async () => {
        const loader = vi.fn().mockRejectedValue(new Error('Backend is down.'));
        const store = createAsyncStore(loader, 'seed');

        await store.load();

        expect(store.$state.get()).toBe('error');
        expect(store.$error.get()).toBe('Backend is down.');
        expect(store.$data.get()).toBe('seed');
    });

    it('shares one request between concurrent load() calls', async () => {
        const loader = vi.fn().mockResolvedValue('x');
        const store = createAsyncStore(loader, '');

        await Promise.all([store.load(), store.load(), store.load()]);

        expect(loader).toHaveBeenCalledTimes(1);
    });

    it('does not refetch once ready, but reload() always does', async () => {
        const loader = vi.fn().mockResolvedValue('x');
        const store = createAsyncStore(loader, '');

        await store.load();
        await store.load();
        expect(loader).toHaveBeenCalledTimes(1);

        await store.reload();
        expect(loader).toHaveBeenCalledTimes(2);
    });

    it('discards a stale response that lands after a newer one', async () => {
        // The bug this guards: a slow first load resolving *after* a fast
        // reload would otherwise overwrite fresh data with stale data.
        const slow = deferred<string>();
        const fast = deferred<string>();
        const loader = vi
            .fn()
            .mockReturnValueOnce(slow.promise)
            .mockReturnValueOnce(fast.promise);
        const store = createAsyncStore(loader, '');

        const first = store.load();
        const second = store.reload();

        fast.resolve('fresh');
        await second;
        expect(store.$data.get()).toBe('fresh');

        slow.resolve('stale');
        await first;
        expect(store.$data.get()).toBe('fresh');
        expect(store.$state.get()).toBe('ready');
    });

    it('ignores a stale rejection so a superseded failure cannot clobber good data', async () => {
        const slow = deferred<string>();
        const fast = deferred<string>();
        const loader = vi
            .fn()
            .mockReturnValueOnce(slow.promise)
            .mockReturnValueOnce(fast.promise);
        const store = createAsyncStore(loader, '');

        const first = store.load();
        const second = store.reload();

        fast.resolve('fresh');
        await second;

        slow.reject(new Error('too late'));
        await first;

        expect(store.$state.get()).toBe('ready');
        expect(store.$error.get()).toBeNull();
        expect(store.$data.get()).toBe('fresh');
    });

    it('reset() returns to the initial value and orphans anything in flight', async () => {
        const pending = deferred<string>();
        const store = createAsyncStore(() => pending.promise, 'seed');

        const inFlight = store.load();
        store.reset();

        expect(store.$state.get()).toBe('idle');
        expect(store.$data.get()).toBe('seed');

        pending.resolve('late');
        await inFlight;
        expect(store.$data.get()).toBe('seed');
    });
});

describe('createCollectionStore', () => {
    interface Row {
        id: string;
        name: string;
    }

    const rows: Row[] = [
        {id: 'a', name: 'Alpha'},
        {id: 'b', name: 'Beta'},
    ];

    it('upsert() appends a new item and replaces an existing one in place', async () => {
        const store = createCollectionStore<Row>(async () => [...rows]);
        await store.load();

        store.upsert({id: 'c', name: 'Gamma'});
        expect(store.$items.get().map((r) => r.id)).toEqual(['a', 'b', 'c']);

        store.upsert({id: 'b', name: 'Beta renamed'});
        expect(store.$items.get().map((r) => r.name)).toEqual(['Alpha', 'Beta renamed', 'Gamma']);
    });

    it('removeById() drops only the matching item', async () => {
        const store = createCollectionStore<Row>(async () => [...rows]);
        await store.load();

        store.removeById('a');
        expect(store.$items.get().map((r) => r.id)).toEqual(['b']);
        expect(store.findById('a')).toBeUndefined();
        expect(store.findById('b')?.name).toBe('Beta');
    });

    it('$isEmpty only reports true once a load has actually finished', async () => {
        const store = createCollectionStore<Row>(async () => []);
        // Idle with no items is "we haven't looked yet", not "there is nothing".
        expect(store.$isEmpty.get()).toBe(false);

        await store.load();
        expect(store.$isEmpty.get()).toBe(true);
    });
});
