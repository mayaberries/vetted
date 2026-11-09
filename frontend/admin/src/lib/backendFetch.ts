import {ActionError} from "astro:actions";
import {requireSession} from "./session";
import type {SessionUser} from "./auth";

const BACKEND_API_URL = import.meta.env.BACKEND_API_URL || "http://localhost:8000/api";

/**
 * Server-only helper for Astro Actions that call the backend on the signed-in
 * user's behalf.
 *
 * This is the only place the session JWT is read for outbound calls. Keeping it
 * here is what lets the browser drive the API without ever holding the token —
 * see lib/api/adminApi.ts.
 */

export interface ActionContext {
    session?: unknown;
}

export async function currentUser(context: ActionContext): Promise<SessionUser> {
    const session = requireSession(context.session) as { get(key: string): Promise<unknown> };
    const user = (await session.get("user")) as SessionUser | undefined;
    if (!user) {
        throw new ActionError({code: "UNAUTHORIZED", message: "Your session has expired. Sign in again."});
    }
    return user;
}

/** The clinic this user administers, or a clean 400 if they somehow have none. */
export async function requireClinicId(context: ActionContext): Promise<string> {
    const user = await currentUser(context);
    if (!user.clinicId) {
        throw new ActionError({
            code: "BAD_REQUEST",
            message: "This account isn't attached to a clinic yet.",
        });
    }
    return user.clinicId;
}

export async function backendFetch<T>(
    context: ActionContext,
    path: string,
    init: RequestInit = {}
): Promise<T> {
    const user = await currentUser(context);

    let res: Response;
    try {
        res = await fetch(`${BACKEND_API_URL}${path}`, {
            ...init,
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${user.token}`,
                ...(init.headers ?? {}),
            },
        });
    } catch {
        throw new ActionError({
            code: "INTERNAL_SERVER_ERROR",
            message: `Couldn't reach the backend at ${BACKEND_API_URL}. Is it running?`,
        });
    }

    if (res.status === 401) {
        throw new ActionError({code: "UNAUTHORIZED", message: "Your session has expired. Sign in again."});
    }
    if (res.status === 403) {
        throw new ActionError({code: "FORBIDDEN", message: "You don't have access to that."});
    }
    if (!res.ok) {
        throw new ActionError({code: "BAD_REQUEST", message: await detailFrom(res)});
    }

    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
}

/** FastAPI puts the useful message in `detail`, which is sometimes a list. */
async function detailFrom(res: Response): Promise<string> {
    try {
        const body = await res.json();
        const detail = body?.detail;
        if (typeof detail === "string") return detail;
        if (Array.isArray(detail) && detail[0]?.msg) return String(detail[0].msg);
    } catch {
        /* no JSON body */
    }
    return `${res.status} ${res.statusText}`;
}
