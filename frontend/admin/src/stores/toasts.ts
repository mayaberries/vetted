import {atom} from "nanostores";

/**
 * Transient feedback banners — the prototype's `showToast()` (docs/proto/shared.js)
 * as a store, so any island can raise one without the page owning a slot for it.
 *
 * The auto-dismiss timer is injectable so unit tests don't have to wait in real
 * time; production code just calls `showToast`.
 */

export type ToastKind = "ok" | "error";

export interface Toast {
    id: string;
    message: string;
    kind: ToastKind;
}

export const DEFAULT_TOAST_MS = 5000;

export function createToastsStore(
    setTimer: typeof setTimeout = setTimeout,
    clearTimer: typeof clearTimeout = clearTimeout
) {
    const $toasts = atom<Toast[]>([]);
    const timers = new Map<string, ReturnType<typeof setTimeout>>();
    let seq = 0;

    function dismiss(id: string) {
        const timer = timers.get(id);
        if (timer !== undefined) {
            clearTimer(timer);
            timers.delete(id);
        }
        $toasts.set($toasts.get().filter((t) => t.id !== id));
    }

    function show(message: string, kind: ToastKind = "ok", ms = DEFAULT_TOAST_MS): string {
        const id = `toast-${++seq}`;
        $toasts.set([...$toasts.get(), {id, message, kind}]);
        if (ms > 0) timers.set(id, setTimer(() => dismiss(id), ms));
        return id;
    }

    return {
        $toasts,
        show,
        dismiss,
        /** Convenience for `catch` blocks — surfaces the rejection as an error toast. */
        showError(err: unknown, fallback = "Something went wrong.") {
            const message =
                err instanceof Error && err.message ? err.message : String(err || fallback);
            return show(message, "error");
        },
        clear() {
            for (const id of [...timers.keys()]) dismiss(id);
            $toasts.set([]);
        },
    };
}

export type ToastsStore = ReturnType<typeof createToastsStore>;
