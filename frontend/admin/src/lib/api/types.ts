/**
 * Wire types for the admin dashboard, mirroring the response schemas in
 * `docs/openapi.json`. Hand-written rather than generated — if you regenerate
 * or the backend changes, reconcile against that file, which is the source of
 * truth.
 *
 * Naming follows the backend's own `*Public` / `*Create` / `*Update`
 * convention (see docs/architecture.md) so a name here maps 1:1 to a schema
 * there.
 */

export type AppointmentStatus =
    | "requested"
    | "confirmed"
    | "declined"
    | "cancelled"
    | "completed";

export type ClinicKeyEnvironment = "live" | "test";

export type UserRole = "clinic_admin" | "clinic_aux" | "client";

export type Weekday =
    | "monday"
    | "tuesday"
    | "wednesday"
    | "thursday"
    | "friday"
    | "saturday"
    | "sunday";

export const WEEKDAYS: Weekday[] = [
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
    "sunday",
];

export interface ClinicPublic {
    id: string;
    name: string;
    slug: string;
    email: string | null;
    phone_number: string | null;
    address: string | null;
    created_at?: string | null;
    updated_at?: string | null;
}

export interface ClinicUpdate {
    name?: string | null;
    email?: string | null;
    phone_number?: string | null;
    address?: string | null;
}

export interface ServicePublic {
    id: string;
    name: string | null;
    description: string | null;
    price: number | null;
    category: string | null;
    duration_minutes: number | null;
    /** The backend returns either a bare clinic id or a populated clinic. */
    clinic: string | ClinicPublic;
}

export interface ServiceCreate {
    name: string;
    price: number;
    category: string;
    description?: string | null;
    duration_minutes?: number | null;
}

export type ServiceUpdate = Partial<ServiceCreate>;

export interface UserPublic {
    email: string | null;
    username: string | null;
    role: UserRole;
    clinic_id: string | null;
}

export interface PetProfilePublic {
    id: string;
    name: string;
    species: string | null;
    breed: string | null;
}

export interface AppointmentPublic {
    id: string;
    user_id: string;
    pet_id: string;
    service_id: string;
    start_time: string;
    end_time: string;
    status: AppointmentStatus | null;
    /** Set together when cancelled or declined; `cancelled_by` says which side wrote it. */
    cancellation_reason: string | null;
    cancelled_by: string | null;
    created_at?: string | null;
    updated_at?: string | null;
    /** Populated by the backend's `populate_appointment` — may be absent. */
    user?: UserPublic | null;
    pet?: PetProfilePublic | null;
    service?: ServicePublic | null;
}

export interface ClinicAPIKeyPublic {
    id: string;
    clinic_id: string;
    public_key: string;
    label: string | null;
    environment: ClinicKeyEnvironment;
    is_active: boolean;
    created_at?: string | null;
    last_used_at?: string | null;
    revoked_at?: string | null;
}

export interface ClinicAPIKeyCreate {
    label?: string | null;
    environment?: ClinicKeyEnvironment;
}

export interface TimeRange {
    start: string; // "09:00"
    end: string; // "17:00"
}

/**
 * `PUT /clinics/{id}/availability/` is a deliberate **full replace**, not a
 * per-day patch — the backend's own schema description says so. Send the whole
 * week every time; an omitted weekday means "closed", not "unchanged".
 */
export interface ClinicAvailability {
    schedule: Partial<Record<Weekday, TimeRange[]>>;
    timezone: string;
}
