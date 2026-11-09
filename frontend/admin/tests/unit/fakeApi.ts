import type {AdminApi} from '../../src/lib/api/adminApi';
import type {
    AppointmentPublic,
    ClinicAPIKeyPublic,
    ClinicAvailability,
    ClinicPublic,
    ServicePublic,
} from '../../src/lib/api/types';

/**
 * A scriptable `AdminApi` for the store unit tests.
 *
 * Stores are `createXStore(api)` factories precisely so this can exist — no
 * Astro build, no network, no `astro:actions` virtual module. Every method
 * records its calls and can be told to reject or to hang.
 *
 * Fixture data mirrors `docs/openapi.json` response shapes. Some of it is
 * deliberately the same data the Playwright roadmap specs in `tests/wip/` use
 * (Biscuit / "Website widget" / dental cleaning) so the two layers describe the
 * same world — see tests/wip/README notes in docs/testing.md.
 */

export const CLINIC_ID = 'clinic-1';

export function aService(over: Partial<ServicePublic> = {}): ServicePublic {
    return {
        id: 'svc-1',
        name: 'Wellness Exam',
        description: 'Annual checkup.',
        price: 65,
        category: 'wellness_exam',
        duration_minutes: 30,
        clinic: CLINIC_ID,
        ...over,
    };
}

export function anAppointment(over: Partial<AppointmentPublic> = {}): AppointmentPublic {
    return {
        id: 'appt-1',
        user_id: 'user-1',
        pet_id: 'pet-1',
        service_id: 'svc-1',
        start_time: '2026-09-01T15:00:00Z',
        end_time: '2026-09-01T15:30:00Z',
        status: 'requested',
        cancellation_reason: null,
        cancelled_by: null,
        pet: {id: 'pet-1', name: 'Biscuit', species: 'dog', breed: null},
        ...over,
    };
}

export function anApiKey(over: Partial<ClinicAPIKeyPublic> = {}): ClinicAPIKeyPublic {
    return {
        id: 'key-1',
        clinic_id: CLINIC_ID,
        public_key: 'pk_live_5f8a2c9d1e3b',
        label: 'Website widget',
        environment: 'live',
        is_active: true,
        ...over,
    };
}

export function aClinic(over: Partial<ClinicPublic> = {}): ClinicPublic {
    return {
        id: CLINIC_ID,
        name: 'Acme Vet Clinic',
        slug: 'acme-vet',
        email: 'hi@acmevet.dev',
        phone_number: '555-0100',
        address: '123 Demo Street',
        ...over,
    };
}

export function anAvailability(over: Partial<ClinicAvailability> = {}): ClinicAvailability {
    return {
        timezone: 'America/Mexico_City',
        schedule: {monday: [{start: '09:00', end: '17:00'}]},
        ...over,
    };
}

export interface FakeApi extends AdminApi {
    calls: string[];
    /** Resolve a pending `hang()` promise by method name. */
    release(method: string, value?: unknown): void;
}

type Handler = (...args: any[]) => any;

/**
 * Build a fake. Pass handlers to override any method; anything not overridden
 * returns an empty result. A handler may return a value, a promise, or throw.
 */
export function createFakeApi(overrides: Record<string, Handler> = {}): FakeApi {
    const calls: string[] = [];
    const pending = new Map<string, (value: unknown) => void>();

    function method(name: string, fallback: Handler): Handler {
        return async (...args: any[]) => {
            calls.push(name);
            const handler = overrides[name] ?? fallback;
            return handler(...args);
        };
    }

    const api = {
        calls,
        release(name: string, value: unknown = undefined) {
            pending.get(name)?.(value);
            pending.delete(name);
        },
        services: {
            list: method('services.list', () => []),
            create: method('services.create', (input: any) => aService({id: 'svc-new', ...input})),
            update: method('services.update', (id: string, patch: any) => aService({id, ...patch})),
            remove: method('services.remove', () => undefined),
        },
        appointments: {
            listForService: method('appointments.listForService', () => []),
            confirm: method('appointments.confirm', (_s: string, id: string) =>
                anAppointment({id, status: 'confirmed'})
            ),
            cancel: method(
                'appointments.cancel',
                (_s: string, id: string, reason?: string | null) =>
                    anAppointment({id, status: 'cancelled', cancellation_reason: reason ?? null})
            ),
            withdraw: method('appointments.withdraw', () => undefined),
        },
        apiKeys: {
            list: method('apiKeys.list', () => []),
            create: method('apiKeys.create', (input: any) =>
                anApiKey({id: 'key-new', label: input?.label ?? null, ...input})
            ),
            revoke: method('apiKeys.revoke', () => undefined),
        },
        clinics: {
            list: method('clinics.list', () => []),
        },
        clinic: {
            get: method('clinic.get', () => aClinic()),
            update: method('clinic.update', (patch: any) => aClinic(patch)),
            getAvailability: method('clinic.getAvailability', () => anAvailability()),
            updateAvailability: method('clinic.updateAvailability', (input: any) => input),
            joinAsStaff: method('clinic.joinAsStaff', () => undefined),
        },
    } as unknown as FakeApi;

    return api;
}

/** A promise that only settles when the test says so. */
export function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (err: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return {promise, resolve, reject};
}
