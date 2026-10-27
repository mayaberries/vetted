import {atom, computed} from "nanostores";
import {createCollectionStore, errorMessage} from "./createAsyncStore";
import type {AdminApi} from "../lib/api/adminApi";
import type {AppointmentPublic, AppointmentStatus} from "../lib/api/types";

export type StatusFilter = AppointmentStatus | "all";

/**
 * The clinic-wide appointment list.
 *
 * **There is no clinic-wide listing endpoint.** The backend only offers
 * `GET /api/services/{service_id}/appointments/`, so this store lists the
 * clinic's services and then fans out one request per service, merging the
 * results. That N+1 lives here, in one place, rather than in every page that
 * wants an appointment list — and it's the thing to delete first if the backend
 * ever grows a `GET /api/clinics/{id}/appointments/` route.
 *
 * **Partial failure is tolerated on purpose.** With N services, one failing
 * request shouldn't blank the whole page, so the fan-out uses `allSettled`:
 * appointments that did load are shown, and `$partialFailure` carries a message
 * the page can surface alongside them. A total failure (the service list itself
 * failing) still rejects normally into `$error`.
 */
export function createAppointmentsStore(api: AdminApi) {
    const $partialFailure = atom<string | null>(null);

    async function loadAll(): Promise<AppointmentPublic[]> {
        const services = await api.services.list();
        $partialFailure.set(null);

        const results = await Promise.allSettled(
            services.map((service) => api.appointments.listForService(service.id))
        );

        const appointments: AppointmentPublic[] = [];
        const failed: string[] = [];
        results.forEach((result, i) => {
            if (result.status === "fulfilled") {
                appointments.push(...result.value);
            } else {
                failed.push(services[i]!.name ?? services[i]!.id);
            }
        });

        if (failed.length) {
            $partialFailure.set(
                `Couldn't load appointments for ${failed.join(", ")}. Everything else is up to date.`
            );
        }
        if (failed.length === services.length && services.length > 0) {
            // Nothing loaded at all — that's a real error, not a partial one.
            throw new Error(errorMessage((results[0] as PromiseRejectedResult).reason));
        }

        return appointments;
    }

    const collection = createCollectionStore<AppointmentPublic>(loadAll);
    const $statusFilter = atom<StatusFilter>("all");

    /** Soonest first — an admin's list is a worklist, not an archive. */
    const $sorted = computed(collection.$items, (items) =>
        [...items].sort((a, b) => a.start_time.localeCompare(b.start_time))
    );

    const $visible = computed([$sorted, $statusFilter], (items, filter) =>
        filter === "all" ? items : items.filter((a) => a.status === filter)
    );

    const $counts = computed(collection.$items, (items) => {
        const counts: Record<string, number> = {};
        for (const a of items) {
            const key = a.status ?? "unknown";
            counts[key] = (counts[key] ?? 0) + 1;
        }
        return counts;
    });

    /**
     * Every mutation needs the appointment's `service_id` for the URL, so they
     * take only an appointment id and look the rest up locally. Acting on an
     * appointment that isn't loaded is a caller bug, not a user error.
     */
    function requireLoaded(appointmentId: string): AppointmentPublic {
        const appointment = collection.findById(appointmentId);
        if (!appointment) {
            throw new Error(`Appointment ${appointmentId} isn't loaded.`);
        }
        return appointment;
    }

    return {
        ...collection,
        $partialFailure,
        $statusFilter,
        $sorted,
        $visible,
        $counts,
        $awaitingConfirmation: computed(collection.$items, (items) =>
            items.filter((a) => a.status === "requested")
        ),

        setStatusFilter(filter: StatusFilter) {
            $statusFilter.set(filter);
        },

        async confirm(appointmentId: string): Promise<AppointmentPublic> {
            const {service_id} = requireLoaded(appointmentId);
            const updated = await api.appointments.confirm(service_id, appointmentId);
            collection.upsert(updated);
            return updated;
        },

        /**
         * Cancelling a `requested` appointment *declines* it rather than
         * cancelling it — the backend decides, so the returned appointment is
         * the source of truth for which it became. `reason` is optional.
         */
        async cancel(appointmentId: string, reason?: string | null): Promise<AppointmentPublic> {
            const {service_id} = requireLoaded(appointmentId);
            const updated = await api.appointments.cancel(service_id, appointmentId, reason);
            collection.upsert(updated);
            return updated;
        },

        /** Withdrawal deletes the appointment outright, unlike cancel. */
        async withdraw(appointmentId: string): Promise<void> {
            const {service_id} = requireLoaded(appointmentId);
            await api.appointments.withdraw(service_id, appointmentId);
            collection.removeById(appointmentId);
        },
    };
}

export type AppointmentsStore = ReturnType<typeof createAppointmentsStore>;
