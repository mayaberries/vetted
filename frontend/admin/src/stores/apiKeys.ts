import {computed} from "nanostores";
import {createCollectionStore} from "./createAsyncStore";
import type {AdminApi} from "../lib/api/adminApi";
import type {ClinicAPIKeyCreate, ClinicAPIKeyPublic} from "../lib/api/types";

/**
 * The clinic's publishable booking keys. Backed by
 * `GET/POST /api/clinics/{id}/api-keys/` and `DELETE .../{key_id}/`.
 *
 * Note that **revoking does not remove the key from the list** — it flips
 * `is_active` to false. A clinic needs to see that a key was revoked (and when)
 * rather than have it silently vanish, and the backend keeps the row for the
 * same reason. `remove` from the underlying collection is deliberately not
 * re-exported.
 */
export function createApiKeysStore(api: AdminApi) {
    const collection = createCollectionStore<ClinicAPIKeyPublic>(() => api.apiKeys.list());

    return {
        ...collection,

        $active: computed(collection.$items, (keys) => keys.filter((k) => k.is_active)),
        $revoked: computed(collection.$items, (keys) => keys.filter((k) => !k.is_active)),

        async create(input: ClinicAPIKeyCreate): Promise<ClinicAPIKeyPublic> {
            const created = await api.apiKeys.create(input);
            collection.upsert(created);
            return created;
        },

        /**
         * Marks the key inactive locally after the backend accepts the revoke.
         * `revoked_at` is set client-side because the DELETE returns no body —
         * a subsequent `reload()` replaces it with the server's timestamp.
         */
        async revoke(keyId: string): Promise<void> {
            await api.apiKeys.revoke(keyId);
            const existing = collection.findById(keyId);
            if (existing) {
                collection.upsert({
                    ...existing,
                    is_active: false,
                    revoked_at: new Date().toISOString(),
                });
            }
        },
    };
}

export type ApiKeysStore = ReturnType<typeof createApiKeysStore>;
