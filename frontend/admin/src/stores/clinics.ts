import {computed} from "nanostores";
import {createCollectionStore} from "./createAsyncStore";
import type {AdminApi} from "../lib/api/adminApi";
import type {ClinicPublic} from "../lib/api/types";

/**
 * Every clinic on the platform — the superadmin's Clinics tab. Backed by
 * `GET /api/clinics/`, which the backend gates on `is_superuser`.
 *
 * The middleware already keeps non-superadmins off `/clinics` (see lib/nav.ts),
 * and the action rejects them a second time. This store doesn't re-check the
 * role: it would be a third copy of the same rule in a layer that can't enforce
 * it anyway, and the pattern to avoid is exactly the duplication documented in
 * docs/architecture.md.
 */
export function createClinicsStore(api: AdminApi) {
    const collection = createCollectionStore<ClinicPublic>(() => api.clinics.list());

    return {
        ...collection,

        $sorted: computed(collection.$items, (clinics) =>
            [...clinics].sort((a, b) => a.name.localeCompare(b.name))
        ),

        $bySlug: computed(collection.$items, (clinics) => {
            const map: Record<string, ClinicPublic> = {};
            for (const c of clinics) map[c.slug] = c;
            return map;
        }),
    };
}

export type ClinicsStore = ReturnType<typeof createClinicsStore>;
