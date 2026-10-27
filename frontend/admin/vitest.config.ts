import {defineConfig} from 'vitest/config';

/**
 * Unit tests for the stores (tests/unit/). Deliberately separate from
 * Playwright: these exercise store logic in isolation with a fake `AdminApi`,
 * no browser, no server, no Astro build.
 *
 * `tests/*.spec.ts` and `tests/wip/` are Playwright's and are excluded here —
 * the two runners share a `tests/` root but never each other's files.
 */
export default defineConfig({
    test: {
        environment: 'node',
        include: ['tests/unit/**/*.test.ts'],
    },
});
