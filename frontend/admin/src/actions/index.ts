import {ActionError, defineAction} from "astro:actions";
import {z} from "astro:schema";
import {requireSession} from "../lib/session";
import {
    buildDemoUser,
    getDemoApiKeys,
    getDemoAppointments,
    getDemoAvailability,
    getDemoClinic,
    getDemoClinics,
    getDemoServices,
} from "../lib/demoData";
import {backendFetch, currentUser, requireClinicId} from "../lib/backendFetch";
import type {SessionUser} from "../lib/auth";
import type {
    AppointmentPublic,
    ClinicAPIKeyPublic,
    ClinicAvailability,
    ClinicPublic,
    ServicePublic,
} from "../lib/api/types";

const BACKEND_API_URL = import.meta.env.BACKEND_API_URL || "http://localhost:8000/api";

/**
 * Astro Actions — the dashboard's entire data layer.
 *
 * Actions run on the server, so the session JWT stays there; the browser calls
 * these instead of the backend directly. Stores reach them through
 * lib/api/actionsApi.ts.
 *
 * Every data action branches on `user.isDemo` first. Demo *reads* return the
 * seed from lib/demoData.ts; demo *writes* echo back a plausible object without
 * persisting, and the client store applies it optimistically. Server-side demo
 * state would be a process-wide singleton shared by every visitor, which is
 * exactly what we don't want.
 */

async function isDemo(context: {session?: unknown}): Promise<boolean> {
    return (await currentUser(context)).isDemo;
}

function demoId(prefix: string): string {
    return `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
}

const serviceInput = {
    name: z.string().min(1, "Name is required."),
    price: z.coerce.number().nonnegative("Price can't be negative."),
    category: z.string().min(1, "Category is required."),
    description: z.string().nullish(),
    duration_minutes: z.coerce.number().int().positive().nullish(),
};

const timeRange = z.object({start: z.string(), end: z.string()});
const availabilityInput = {
    timezone: z.string(),
    schedule: z.record(z.string(), z.array(timeRange)),
};

export const server = {
    login: defineAction({
        accept: "form",
        input: z.object({
            email: z.string().email("Enter a valid email address."),
            password: z.string().min(1, "Password is required."),
        }),
        handler: async ({email, password}, context) => {
            const tokenRes = await fetch(`${BACKEND_API_URL}/users/login/token`, {
                method: "POST",
                headers: {"Content-Type": "application/x-www-form-urlencoded"},
                // Backend expects OAuth2PasswordRequestForm -- "username", not
                // "email", is the field name it reads (see
                // backend/app/api/routes/auth/users.py).
                body: new URLSearchParams({username: email, password}),
            });

            if (!tokenRes.ok) {
                throw new ActionError({
                    code: "UNAUTHORIZED",
                    message: "Incorrect email or password.",
                });
            }

            const {access_token} = (await tokenRes.json()) as { access_token: string };

            const meRes = await fetch(`${BACKEND_API_URL}/users/me/`, {
                headers: {Authorization: `Bearer ${access_token}`},
            });
            if (!meRes.ok) {
                // The backend accepted the login but rejected the token right
                // back -- a server-side problem, not a bad password, so the
                // message shouldn't send someone back to retyping a correct one.
                throw new ActionError({
                    code: "INTERNAL_SERVER_ERROR",
                    message: "Signed in, but couldn't load your profile. Please try again.",
                });
            }
            const me = await meRes.json();

            const sessionUser: SessionUser = {
                token: access_token,
                email: me.email,
                username: me.username,
                isSuperuser: me.is_superuser,
                role: me.role ?? null,
                clinicId: me.clinic_id ?? null,
                isDemo: false,
            };

            requireSession(context.session).set("user", sessionUser);
            return {email: sessionUser.email};
        },
    }),

    logout: defineAction({
        accept: "form",
        handler: async (_input, context) => {
            requireSession(context.session).destroy();
            return {};
        },
    }),

    // Seeds a fake clinic-admin session
    demoLogin: defineAction({
        accept: "form",
        handler: async (_input, context) => {
            requireSession(context.session).set("user", buildDemoUser());
            return {};
        },
    }),

    services: {
        list: defineAction({
            handler: async (_input, context): Promise<ServicePublic[]> => {
                if (await isDemo(context)) return getDemoServices();
                return backendFetch<ServicePublic[]>(context, "/services/");
            },
        }),
        create: defineAction({
            input: z.object(serviceInput),
            handler: async (input, context): Promise<ServicePublic> => {
                if (await isDemo(context)) {
                    return {
                        id: demoId("svc"),
                        name: input.name,
                        description: input.description ?? null,
                        price: input.price,
                        category: input.category,
                        duration_minutes: input.duration_minutes ?? null,
                        clinic: await requireClinicId(context),
                    };
                }
                return backendFetch<ServicePublic>(context, "/services/", {
                    method: "POST",
                    body: JSON.stringify(input),
                });
            },
        }),
        update: defineAction({
            input: z.object({serviceId: z.string()}).extend({
                name: serviceInput.name.optional(),
                price: serviceInput.price.optional(),
                category: serviceInput.category.optional(),
                description: serviceInput.description,
                duration_minutes: serviceInput.duration_minutes,
            }),
            handler: async ({serviceId, ...patch}, context): Promise<ServicePublic> => {
                if (await isDemo(context)) {
                    const existing = getDemoServices().find((s) => s.id === serviceId);
                    return {...(existing ?? ({id: serviceId} as ServicePublic)), ...patch} as ServicePublic;
                }
                return backendFetch<ServicePublic>(context, `/services/${serviceId}/`, {
                    method: "PUT",
                    body: JSON.stringify(patch),
                });
            },
        }),
        remove: defineAction({
            input: z.object({serviceId: z.string()}),
            handler: async ({serviceId}, context) => {
                if (await isDemo(context)) return {id: serviceId};
                await backendFetch(context, `/services/${serviceId}/`, {method: "DELETE"});
                return {id: serviceId};
            },
        }),
    },

    appointments: {
        listForService: defineAction({
            input: z.object({serviceId: z.string()}),
            handler: async ({serviceId}, context): Promise<AppointmentPublic[]> => {
                if (await isDemo(context)) {
                    return getDemoAppointments().filter((a) => a.service_id === serviceId);
                }
                return backendFetch<AppointmentPublic[]>(
                    context,
                    `/services/${serviceId}/appointments/`
                );
            },
        }),
        confirm: defineAction({
            input: z.object({serviceId: z.string(), appointmentId: z.string()}),
            handler: async ({serviceId, appointmentId}, context): Promise<AppointmentPublic> => {
                if (await isDemo(context)) return demoTransition(appointmentId, "confirmed");
                return backendFetch<AppointmentPublic>(
                    context,
                    `/services/${serviceId}/appointments/${appointmentId}/confirm`,
                    {method: "PUT"}
                );
            },
        }),
        cancel: defineAction({
            input: z.object({serviceId: z.string(), appointmentId: z.string()}),
            handler: async ({serviceId, appointmentId}, context): Promise<AppointmentPublic> => {
                if (await isDemo(context)) return demoTransition(appointmentId, "cancelled");
                return backendFetch<AppointmentPublic>(
                    context,
                    `/services/${serviceId}/appointments/${appointmentId}/cancel`,
                    {method: "PUT"}
                );
            },
        }),
        withdraw: defineAction({
            input: z.object({serviceId: z.string(), appointmentId: z.string()}),
            handler: async ({serviceId, appointmentId}, context) => {
                if (await isDemo(context)) return {id: appointmentId};
                await backendFetch(
                    context,
                    `/services/${serviceId}/appointments/${appointmentId}`,
                    {method: "DELETE"}
                );
                return {id: appointmentId};
            },
        }),
    },

    apiKeys: {
        list: defineAction({
            handler: async (_input, context): Promise<ClinicAPIKeyPublic[]> => {
                if (await isDemo(context)) return getDemoApiKeys();
                const clinicId = await requireClinicId(context);
                return backendFetch<ClinicAPIKeyPublic[]>(context, `/clinics/${clinicId}/api-keys/`);
            },
        }),
        create: defineAction({
            input: z.object({
                label: z.string().nullish(),
                environment: z.enum(["live", "test"]).default("live"),
            }),
            handler: async (input, context): Promise<ClinicAPIKeyPublic> => {
                const clinicId = await requireClinicId(context);
                if (await isDemo(context)) {
                    return {
                        id: demoId("key"),
                        clinic_id: clinicId,
                        public_key: `pk_${input.environment}_${Math.random().toString(36).slice(2, 14)}`,
                        label: input.label ?? null,
                        environment: input.environment,
                        is_active: true,
                        created_at: new Date().toISOString(),
                    };
                }
                return backendFetch<ClinicAPIKeyPublic>(context, `/clinics/${clinicId}/api-keys/`, {
                    method: "POST",
                    body: JSON.stringify(input),
                });
            },
        }),
        revoke: defineAction({
            input: z.object({keyId: z.string()}),
            handler: async ({keyId}, context) => {
                if (await isDemo(context)) return {id: keyId};
                const clinicId = await requireClinicId(context);
                await backendFetch(context, `/clinics/${clinicId}/api-keys/${keyId}/`, {
                    method: "DELETE",
                });
                return {id: keyId};
            },
        }),
    },

    clinics: {
        list: defineAction({
            handler: async (_input, context): Promise<ClinicPublic[]> => {
                const user = await currentUser(context);
                if (!user.isSuperuser) {
                    throw new ActionError({
                        code: "FORBIDDEN",
                        message: "Only the platform superuser can list every clinic.",
                    });
                }
                if (user.isDemo) return getDemoClinics();
                return backendFetch<ClinicPublic[]>(context, "/clinics/");
            },
        }),
    },

    clinic: {
        get: defineAction({
            handler: async (_input, context): Promise<ClinicPublic> => {
                if (await isDemo(context)) return getDemoClinic();
                const clinicId = await requireClinicId(context);
                return backendFetch<ClinicPublic>(context, `/clinics/${clinicId}/`);
            },
        }),
        update: defineAction({
            input: z.object({
                name: z.string().min(1).optional(),
                email: z.string().email().nullish(),
                phone_number: z.string().nullish(),
                address: z.string().nullish(),
            }),
            handler: async (patch, context): Promise<ClinicPublic> => {
                if (await isDemo(context)) return {...getDemoClinic(), ...patch} as ClinicPublic;
                const clinicId = await requireClinicId(context);
                return backendFetch<ClinicPublic>(context, `/clinics/${clinicId}/`, {
                    method: "PUT",
                    body: JSON.stringify(patch),
                });
            },
        }),
        getAvailability: defineAction({
            handler: async (_input, context): Promise<ClinicAvailability> => {
                if (await isDemo(context)) return getDemoAvailability();
                const clinicId = await requireClinicId(context);
                return backendFetch<ClinicAvailability>(context, `/clinics/${clinicId}/availability/`);
            },
        }),
        updateAvailability: defineAction({
            input: z.object(availabilityInput),
            handler: async (input, context): Promise<ClinicAvailability> => {
                if (await isDemo(context)) return input as ClinicAvailability;
                const clinicId = await requireClinicId(context);
                return backendFetch<ClinicAvailability>(
                    context,
                    `/clinics/${clinicId}/availability/`,
                    {method: "PUT", body: JSON.stringify(input)}
                );
            },
        }),
        joinAsStaff: defineAction({
            input: z.object({clinicId: z.string()}),
            handler: async ({clinicId}, context) => {
                if (await isDemo(context)) return {ok: true};
                await backendFetch(context, `/clinics/${clinicId}/staff/join`, {method: "POST"});
                return {ok: true};
            },
        }),
    },
};

function demoTransition(
    appointmentId: string,
    status: AppointmentPublic["status"]
): AppointmentPublic {
    const existing = getDemoAppointments().find((a) => a.id === appointmentId);
    if (!existing) {
        throw new ActionError({code: "NOT_FOUND", message: "No such appointment."});
    }
    return {...existing, status};
}
