import {computed} from "nanostores";
import {createAsyncStore} from "./createAsyncStore";
import type {AdminApi} from "../lib/api/adminApi";
import type {
    ClinicAvailability,
    ClinicPublic,
    ClinicUpdate,
    TimeRange,
    Weekday,
} from "../lib/api/types";

/**
 * The clinic's own profile — `GET/PUT /api/clinics/{id}/`.
 */
export function createClinicProfileStore(api: AdminApi) {
    const store = createAsyncStore<ClinicPublic | null>(() => api.clinic.get(), null);

    return {
        ...store,
        $clinic: store.$data,

        async save(patch: ClinicUpdate): Promise<ClinicPublic> {
            const updated = await api.clinic.update(patch);
            store.set(updated);
            return updated;
        },

        async joinAsStaff(clinicId: string): Promise<void> {
            await api.clinic.joinAsStaff(clinicId);
        },
    };
}

const EMPTY_AVAILABILITY: ClinicAvailability = {schedule: {}, timezone: "UTC"};

/**
 * The clinic's weekly hours — `GET/PUT /api/clinics/{id}/availability/`.
 *
 * **The PUT is a full replace, not a per-day patch.** The backend's own schema
 * says so: an omitted weekday means "closed", not "unchanged". So this store
 * keeps the whole week in local state, lets the page edit a day at a time via
 * `setDay`/`clearDay`, and sends everything on `save()`. Editing a day does not
 * hit the network — that only happens on save, which is what makes an hours
 * editor feel like a form rather than a series of requests.
 */
export function createAvailabilityStore(api: AdminApi) {
    const store = createAsyncStore<ClinicAvailability>(
        () => api.clinic.getAvailability(),
        EMPTY_AVAILABILITY
    );

    function current(): ClinicAvailability {
        return store.$data.get() ?? EMPTY_AVAILABILITY;
    }

    return {
        ...store,
        $availability: store.$data,
        $schedule: computed(store.$data, (a) => a?.schedule ?? {}),
        $timezone: computed(store.$data, (a) => a?.timezone ?? "UTC"),
        $openDays: computed(store.$data, (a) =>
            Object.entries(a?.schedule ?? {})
                .filter(([, ranges]) => (ranges?.length ?? 0) > 0)
                .map(([day]) => day as Weekday)
        ),

        /** Local edit — nothing is sent until `save()`. */
        setDay(day: Weekday, ranges: TimeRange[]) {
            const now = current();
            store.set({...now, schedule: {...now.schedule, [day]: ranges}});
        },

        /** Local edit. Removes the day entirely, which the backend reads as closed. */
        clearDay(day: Weekday) {
            const now = current();
            const {[day]: _removed, ...rest} = now.schedule;
            store.set({...now, schedule: rest});
        },

        setTimezone(timezone: string) {
            store.set({...current(), timezone});
        },

        async save(): Promise<ClinicAvailability> {
            const saved = await api.clinic.updateAvailability(current());
            store.set(saved);
            return saved;
        },
    };
}

export type ClinicProfileStore = ReturnType<typeof createClinicProfileStore>;
export type AvailabilityStore = ReturnType<typeof createAvailabilityStore>;
