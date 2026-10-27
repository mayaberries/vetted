import type {SessionUser} from "./auth";
import type {
    AppointmentPublic,
    ClinicAPIKeyPublic,
    ClinicAvailability,
    ClinicPublic,
    ServicePublic,
} from "./api/types";

/**
 * Seeded data for demo mode — the "Demo · Clinic admin" button on the sign-in
 * page. Lets the whole dashboard (and the Playwright suite) run with no API or
 * database up.
 *
 * These return the **real wire shapes** from api/types.ts on purpose, so store
 * and component code is identical in demo and live mode. If you change a type
 * there, change the seed here.
 *
 * Demo *writes* are not persisted anywhere: the actions echo back a plausible
 * object and the client store applies it optimistically. That means demo edits
 * live in one browser session and vanish on reload — which is what we want,
 * since server-side demo state would be a process-wide singleton shared by
 * every visitor.
 */

export const DEMO_CLINIC_ID = "demo-clinic-1";

export function buildDemoUser(): SessionUser {
    return {
        token: "demo-token",
        email: "demo@acmevet.dev",
        username: "demo-clinic-admin",
        isSuperuser: false,
        role: "clinic_admin",
        clinicId: DEMO_CLINIC_ID,
        isDemo: true,
    };
}

function inHours(h: number): string {
    return new Date(Date.now() + h * 3600_000).toISOString();
}

export function getDemoClinic(): ClinicPublic {
    return {
        id: DEMO_CLINIC_ID,
        name: "Acme Vet Clinic",
        slug: "acme-vet",
        email: "hi@acmevet.dev",
        phone_number: "555-0100",
        address: "123 Demo Street, CDMX",
        created_at: inHours(-800),
    };
}

/** Superadmin view — every clinic on the platform. */
export function getDemoClinics(): ClinicPublic[] {
    return [
        getDemoClinic(),
        {
            id: "demo-clinic-2",
            name: "Northside Animal Hospital",
            slug: "northside-animal",
            email: "hello@northside.dev",
            phone_number: "555-0142",
            address: null,
            created_at: inHours(-300),
        },
        {
            id: "demo-clinic-3",
            name: "Furry Friends Pet Care",
            slug: "furry-friends",
            email: "contact@furryfriends.dev",
            phone_number: "555-0177",
            address: null,
            created_at: inHours(-40),
        },
    ];
}

export function getDemoServices(): ServicePublic[] {
    return [
        {
            id: "svc-1",
            name: "Wellness Exam",
            description: "Annual checkup and vaccinations.",
            category: "wellness_exam",
            duration_minutes: 30,
            price: 65,
            clinic: DEMO_CLINIC_ID,
        },
        {
            id: "svc-2",
            name: "Nail Trim",
            description: "Quick nail trim, walk-ins welcome.",
            category: "nail_trim",
            duration_minutes: 15,
            price: 20,
            clinic: DEMO_CLINIC_ID,
        },
    ];
}

export function getDemoAppointments(): AppointmentPublic[] {
    const svc = getDemoServices();
    const base = (
        id: string,
        service_id: string,
        start: number,
        status: AppointmentPublic["status"],
        petName: string,
        ownerName: string
    ): AppointmentPublic => ({
        id,
        user_id: `user-${id}`,
        pet_id: `pet-${id}`,
        service_id,
        start_time: inHours(start),
        end_time: inHours(start + 0.5),
        status,
        user: {
            email: `${ownerName.split(" ")[0]!.toLowerCase()}@example.com`,
            username: ownerName.toLowerCase().replace(/\s+/g, "-"),
            role: "client",
            clinic_id: DEMO_CLINIC_ID,
        },
        pet: {id: `pet-${id}`, name: petName, species: "dog", breed: null},
        service: svc.find((s) => s.id === service_id) ?? null,
    });

    return [
        base("appt-1", "svc-1", 2, "requested", "Biscuit", "Jordan Lee"),
        base("appt-2", "svc-1", 26, "confirmed", "Mochi", "Sam Rivera"),
        base("appt-3", "svc-1", -30, "cancelled", "Pepper", "Alex Kim"),
        base("appt-4", "svc-2", 4, "requested", "Waffles", "Robin Diaz"),
    ];
}

export function getDemoApiKeys(): ClinicAPIKeyPublic[] {
    return [
        {
            id: "key-1",
            clinic_id: DEMO_CLINIC_ID,
            public_key: "pk_live_5f8a2c9d1e3b",
            label: "Website widget",
            environment: "live",
            is_active: true,
            created_at: inHours(-500),
        },
        {
            id: "key-2",
            clinic_id: DEMO_CLINIC_ID,
            public_key: "pk_test_a1b2c3d4e5f6",
            label: "Local testing",
            environment: "test",
            is_active: false,
            created_at: inHours(-200),
            revoked_at: inHours(-50),
        },
    ];
}

export function getDemoAvailability(): ClinicAvailability {
    const nineToFive = [{start: "09:00", end: "17:00"}];
    return {
        timezone: "America/Mexico_City",
        schedule: {
            monday: nineToFive,
            tuesday: nineToFive,
            wednesday: nineToFive,
            thursday: nineToFive,
            friday: [{start: "09:00", end: "13:00"}],
        },
    };
}
