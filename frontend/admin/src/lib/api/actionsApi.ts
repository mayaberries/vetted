import {actions} from "astro:actions";
import type {AdminApi} from "./adminApi";

/**
 * The real `AdminApi`, backed by Astro Actions (src/actions/index.ts).
 *
 * Actions run on the server, where the session — and therefore the JWT — lives,
 * so calling one from the browser never exposes the token. That is the whole
 * reason the stores don't just `fetch()` the backend directly.
 *
 * Astro returns a `{data, error}` envelope; `unwrap` turns it into a plain
 * promise so store code has one failure mode (a rejection) instead of two.
 */
async function unwrap<T>(call: Promise<{ data?: T; error?: { message: string } }>): Promise<T> {
    const {data, error} = await call;
    if (error) throw new Error(error.message);
    return data as T;
}

export const actionsApi: AdminApi = {
    services: {
        list: () => unwrap(actions.services.list()),
        create: (input) => unwrap(actions.services.create(input)),
        update: (serviceId, input) => unwrap(actions.services.update({serviceId, ...input})),
        remove: (serviceId) => unwrap(actions.services.remove({serviceId})).then(() => undefined),
    },
    appointments: {
        listForService: (serviceId) => unwrap(actions.appointments.listForService({serviceId})),
        confirm: (serviceId, appointmentId) =>
            unwrap(actions.appointments.confirm({serviceId, appointmentId})),
        cancel: (serviceId, appointmentId) =>
            unwrap(actions.appointments.cancel({serviceId, appointmentId})),
        withdraw: (serviceId, appointmentId) =>
            unwrap(actions.appointments.withdraw({serviceId, appointmentId})).then(() => undefined),
    },
    apiKeys: {
        list: () => unwrap(actions.apiKeys.list()),
        create: (input) => unwrap(actions.apiKeys.create(input)),
        revoke: (keyId) => unwrap(actions.apiKeys.revoke({keyId})).then(() => undefined),
    },
    clinics: {
        list: () => unwrap(actions.clinics.list()),
    },
    clinic: {
        get: () => unwrap(actions.clinic.get()),
        update: (input) => unwrap(actions.clinic.update(input)),
        getAvailability: () => unwrap(actions.clinic.getAvailability()),
        updateAvailability: (input) => unwrap(actions.clinic.updateAvailability(input)),
        joinAsStaff: (clinicId) =>
            unwrap(actions.clinic.joinAsStaff({clinicId})).then(() => undefined),
    },
};
