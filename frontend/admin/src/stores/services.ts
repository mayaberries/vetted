import {computed} from "nanostores";
import {createCollectionStore} from "./createAsyncStore";
import type {AdminApi} from "../lib/api/adminApi";
import type {ServiceCreate, ServicePublic, ServiceUpdate} from "../lib/api/types";

/**
 * The clinic's services. Backed by `GET/POST /api/services/` and
 * `PUT/DELETE /api/services/{id}/`.
 *
 * Mutations await the API before touching local state, so a rejected request
 * leaves the collection untouched and the caller sees the rejection.
 */
export function createServicesStore(api: AdminApi) {
    const collection = createCollectionStore<ServicePublic>(() => api.services.list());

    return {
        ...collection,

        /** Alphabetical, with unnamed services last rather than crashing on null. */
        $sorted: computed(collection.$items, (items) =>
            [...items].sort((a, b) => (a.name ?? "￿").localeCompare(b.name ?? "￿"))
        ),

        $byId: computed(collection.$items, (items) => {
            const map: Record<string, ServicePublic> = {};
            for (const s of items) map[s.id] = s;
            return map;
        }),

        async create(input: ServiceCreate): Promise<ServicePublic> {
            const created = await api.services.create(input);
            collection.upsert(created);
            return created;
        },

        async update(serviceId: string, patch: ServiceUpdate): Promise<ServicePublic> {
            const updated = await api.services.update(serviceId, patch);
            collection.upsert(updated);
            return updated;
        },

        async remove(serviceId: string): Promise<void> {
            await api.services.remove(serviceId);
            collection.removeById(serviceId);
        },
    };
}

export type ServicesStore = ReturnType<typeof createServicesStore>;
