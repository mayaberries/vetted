import type {
    AppointmentPublic,
    ClinicAPIKeyCreate,
    ClinicAPIKeyPublic,
    ClinicAvailability,
    ClinicPublic,
    ClinicUpdate,
    ServiceCreate,
    ServicePublic,
    ServiceUpdate,
} from "./types";

/**
 * The port every store talks to. Two things it buys us:
 *
 * 1. **The JWT never reaches the browser.** The real implementation
 *    (actionsApi.ts) calls Astro Actions, which attach the token from the
 *    server-side session. Nothing here takes or returns a token.
 * 2. **Stores are unit-testable.** Each store is a `createXStore(api)` factory,
 *    so a test passes a fake instead of standing up Astro's virtual modules.
 *    See tests/unit/.
 *
 * Methods reject on failure — implementations unwrap Astro's `{data, error}`
 * envelope into a plain promise so store code isn't checking two things.
 */
export interface AdminApi {
    services: {
        list(): Promise<ServicePublic[]>;
        create(input: ServiceCreate): Promise<ServicePublic>;
        update(serviceId: string, input: ServiceUpdate): Promise<ServicePublic>;
        remove(serviceId: string): Promise<void>;
    };
    appointments: {
        /**
         * Per-service, because that's all the backend offers — there is no
         * clinic-wide listing route. The store fans out across services and
         * merges; see stores/appointments.ts.
         */
        listForService(serviceId: string): Promise<AppointmentPublic[]>;
        confirm(serviceId: string, appointmentId: string): Promise<AppointmentPublic>;
        /**
         * Cancelling a `requested` appointment declines it instead — the backend
         * picks the resulting status, so the response is the source of truth for
         * what it became. `reason` is optional; cancelling silently is allowed.
         */
        cancel(
            serviceId: string,
            appointmentId: string,
            reason?: string | null
        ): Promise<AppointmentPublic>;
        withdraw(serviceId: string, appointmentId: string): Promise<void>;
    };
    apiKeys: {
        list(): Promise<ClinicAPIKeyPublic[]>;
        create(input: ClinicAPIKeyCreate): Promise<ClinicAPIKeyPublic>;
        revoke(keyId: string): Promise<void>;
    };
    clinics: {
        /** Superadmin only — `GET /api/clinics/`. */
        list(): Promise<ClinicPublic[]>;
    };
    clinic: {
        get(): Promise<ClinicPublic>;
        update(input: ClinicUpdate): Promise<ClinicPublic>;
        getAvailability(): Promise<ClinicAvailability>;
        /** Full replace of the week — see the note on ClinicAvailability. */
        updateAvailability(input: ClinicAvailability): Promise<ClinicAvailability>;
        joinAsStaff(clinicId: string): Promise<void>;
    };
}
