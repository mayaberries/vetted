import {atom, computed} from "nanostores";
import type {ReadableAtom} from "nanostores";

/**
 * The async-data primitive every domain store in this folder is built on.
 *
 * !! CLIENT-SIDE ONLY -- see the warning in stores/auth.ts !!
 * Nanostores atoms are module singletons shared by every concurrent request
 * under `output: "server"`. Nothing here may be loaded or mutated during SSR;
 * call `load()` from a Vue `onMounted` (or a user interaction), never from
 * `.astro` frontmatter.
 *
 * Two behaviours worth knowing, because they're the reason this exists instead
 * of an ad-hoc `ref(null)` in each component:
 *
 *   1. **Concurrent `load()` calls share one request.** Two islands mounting at
 *      once won't fire two fetches.
 *   2. **Stale responses are discarded.** If `reload()` is called while an
 *      earlier request is still in flight, the earlier response is dropped even
 *      if it lands second. Without this, a fast "refresh" after a slow initial
 *      load silently overwrites fresh data with stale data.
 */

export type LoadState = "idle" | "loading" | "ready" | "error";

export interface AsyncStore<T> {
    $data: ReadableAtom<T>;
    $state: ReadableAtom<LoadState>;
    $error: ReadableAtom<string | null>;
    $isLoading: ReadableAtom<boolean>;
    /** Fetch once. No-op if already loaded or in flight. */
    load(): Promise<void>;
    /** Always refetch, discarding any in-flight response. */
    reload(): Promise<void>;
    /** Overwrite the data locally without a request (optimistic updates). */
    set(next: T): void;
    /** Back to the initial value, as if never loaded. */
    reset(): void;
}

export function errorMessage(err: unknown, fallback = "Something went wrong."): string {
    if (typeof err === "string") return err;
    if (err instanceof Error && err.message) return err.message;
    if (err && typeof err === "object" && "message" in err) {
        const m = (err as { message?: unknown }).message;
        if (typeof m === "string" && m) return m;
    }
    return fallback;
}

export function createAsyncStore<T>(loader: () => Promise<T>, initial: T): AsyncStore<T> {
    const $data = atom<T>(initial);
    const $state = atom<LoadState>("idle");
    const $error = atom<string | null>(null);
    const $isLoading = computed($state, (s) => s === "loading");

    // Monotonic request id. Only the newest request may write to $data.
    let seq = 0;
    let inFlight: Promise<void> | null = null;

    async function run(): Promise<void> {
        const mine = ++seq;
        $state.set("loading");
        $error.set(null);
        try {
            const result = await loader();
            if (mine !== seq) return; // superseded — drop this response
            $data.set(result);
            $state.set("ready");
        } catch (err) {
            if (mine !== seq) return;
            $error.set(errorMessage(err));
            $state.set("error");
        } finally {
            if (mine === seq) inFlight = null;
        }
    }

    function reload(): Promise<void> {
        inFlight = run();
        return inFlight;
    }

    function load(): Promise<void> {
        if (inFlight) return inFlight;
        if ($state.get() === "ready") return Promise.resolve();
        return reload();
    }

    return {
        $data,
        $state,
        $error,
        $isLoading,
        load,
        reload,
        set: (next) => $data.set(next),
        reset() {
            seq++; // orphan anything in flight
            inFlight = null;
            $data.set(initial);
            $state.set("idle");
            $error.set(null);
        },
    };
}

export interface CollectionStore<T> extends AsyncStore<T[]> {
    $items: ReadableAtom<T[]>;
    $isEmpty: ReadableAtom<boolean>;
    /** Insert, or replace in place if an item with the same id exists. */
    upsert(item: T): void;
    removeById(id: string): void;
    findById(id: string): T | undefined;
}

export function createCollectionStore<T>(
    loader: () => Promise<T[]>,
    getId: (item: T) => string = (item) => (item as { id: string }).id
): CollectionStore<T> {
    const base = createAsyncStore<T[]>(loader, []);
    const $items = base.$data;

    return {
        ...base,
        $items,
        $isEmpty: computed([base.$data, base.$state], (items, state) =>
            state === "ready" && items.length === 0
        ),
        upsert(item) {
            const items = $items.get();
            const i = items.findIndex((existing) => getId(existing) === getId(item));
            base.set(i === -1 ? [...items, item] : items.map((e, n) => (n === i ? item : e)));
        },
        removeById(id) {
            base.set($items.get().filter((item) => getId(item) !== id));
        },
        findById(id) {
            return $items.get().find((item) => getId(item) === id);
        },
    };
}
