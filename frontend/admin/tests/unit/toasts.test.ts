import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {createToastsStore, DEFAULT_TOAST_MS} from '../../src/stores/toasts';

describe('toasts store', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('stacks toasts and auto-dismisses each after its own delay', () => {
        const toasts = createToastsStore();

        toasts.show('Saved.');
        toasts.show('Also saved.');
        expect(toasts.$toasts.get()).toHaveLength(2);

        vi.advanceTimersByTime(DEFAULT_TOAST_MS);
        expect(toasts.$toasts.get()).toHaveLength(0);
    });

    it('dismisses one toast without disturbing the others', () => {
        const toasts = createToastsStore();
        const first = toasts.show('First');
        toasts.show('Second');

        toasts.dismiss(first);

        expect(toasts.$toasts.get().map((t) => t.message)).toEqual(['Second']);
    });

    it('keeps a toast up indefinitely when the delay is 0', () => {
        const toasts = createToastsStore();
        toasts.show('Sticky', 'error', 0);

        vi.advanceTimersByTime(DEFAULT_TOAST_MS * 10);

        expect(toasts.$toasts.get()).toHaveLength(1);
    });

    it('showError pulls the message off an Error for catch blocks', () => {
        const toasts = createToastsStore();

        toasts.showError(new Error('Service has appointments.'));

        expect(toasts.$toasts.get()[0]).toMatchObject({
            message: 'Service has appointments.',
            kind: 'error',
        });
    });

    it('clear() empties the stack and cancels pending timers', () => {
        const toasts = createToastsStore();
        toasts.show('One');
        toasts.show('Two');

        toasts.clear();
        expect(toasts.$toasts.get()).toHaveLength(0);

        // No lingering timer should fire and touch the store afterwards.
        vi.advanceTimersByTime(DEFAULT_TOAST_MS);
        expect(toasts.$toasts.get()).toHaveLength(0);
    });
});
