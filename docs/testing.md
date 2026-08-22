# Testing

```bash
make test             # everything
make test-be          # backend — pytest, needs the dockerized db up
make test-admin       # admin dashboard — unit + end-to-end
make test-admin-unit  # admin store unit tests only (vitest, no browser, ~200ms)
make test-admin-e2e   # admin Playwright tests only
```

CI (`.github/workflows/tests.yml`) runs both on push/PR to `master`: the backend
fully dockerized via `make test-be-docker` (build + ephemeral db, no local
Postgres needed), and the admin suite on `lts/*` Node with the Playwright HTML
report uploaded as an artifact for 30 days.

## Backend (`backend/tests/`)

pytest + pytest-asyncio in strict mode, driving httpx `AsyncClient` **against the
ASGI app directly** — no live server needed.

Tests are grouped by domain, matching the shape described in
[architecture.md](architecture.md):

```
tests/appointments/    test_create.py, test_accept.py, test_cancel.py, …
tests/clinics/  tests/evaluations/  tests/pets/  tests/profiles/
tests/public_booking/  tests/services/  tests/users/  tests/feed/
tests/_fixtures/       shared fixtures
tests/_helpers/
```

> **Known limitation — the test DB is not reset between tests.** Migrations are
> session-scoped and users aren't recreated if they already exist by email. This
> causes flaky failures when two tests' appointment fixtures land in overlapping
> time windows for the same provider.
>
> Current mitigation: wide randomized fixture time windows. That is a workaround,
> not a fix — the real answer is per-test transaction rollback, which hasn't been
> built. **If you see an intermittent appointment-conflict failure, suspect this
> before suspecting your change.**

`tests/feed/` is skipped — the Feed feature is dormant, see
[domain.md](domain.md#feed).

## Admin dashboard (`frontend/admin/tests/`)

**Two runners share the `tests/` root.** Playwright owns `*.spec.ts`, vitest owns
`tests/unit/**/*.test.ts`. Both configs are explicit about this — Playwright's
default `testMatch` would otherwise pick up the vitest files and fail on them.

```
tests/onboarding.spec.ts   Playwright — the signup wizard, end to end
tests/nav.spec.ts          Playwright — tab bar + the role gate
tests/fixtures/            input data for Playwright specs
tests/helpers/             page actions
tests/wip/                 Playwright roadmap specs — see below
tests/unit/                vitest — store logic in isolation
tests/unit/fakeApi.ts      the scriptable AdminApi + fixtures
```

### Unit tests (vitest)

Node environment, no browser, no server, no Astro build — they run in a couple
of hundred milliseconds. Each store is a `createXStore(api)` factory precisely so
a test can pass a fake `AdminApi`; see
[admin-dashboard.md](admin-dashboard.md#the-data-layer).

What's worth testing here rather than through the UI: the shared async
primitive's guarantees (concurrent loads share one request; stale responses are
discarded), the appointments fan-out including partial failure, and the rule that
**a rejected mutation must leave local state untouched**.

Several of these mirror the acceptance criteria in `tests/wip/` on purpose — the
store test proves the transition, the Playwright spec will prove a person can
actually do it in a browser. Both are wanted; neither replaces the other.

### End-to-end (Playwright)

Three browser projects (chromium, firefox, webkit). Specs run against the
**built** Node entrypoint, not `astro dev` — see the gotcha in
[development.md](development.md#gotchas-worth-knowing-before-you-lose-time-to-them).

Everything runs in demo mode, so **no API or database needs to be up.**

Data and page-actions are kept in separate files (`fixtures/onboarding.ts` vs
`helpers/onboarding.ts`) so other specs can reuse either half.

### `tests/wip/` — the roadmap as skipped tests

These specs describe admin UI that **doesn't exist yet**. They're written against
`docs/openapi.json` (the backend already supports every endpoint they reference).
Every `describe` is `.skip`'d, so they report as *skipped* rather than failing —
**that skip count is the roadmap, and it should shrink as pages get built.**

| Spec | Store behind it | UI status |
|---|---|---|
| `services.spec.ts` | `servicesStore` ✅ | route stub only |
| `appointments.spec.ts` | `appointmentsStore` ✅ | route stub only |
| `api-keys.spec.ts` | `apiKeysStore` ✅ | route stub; onboarding issues the first key |
| `clinic-settings.spec.ts` | `clinicProfileStore` + `availabilityStore` ✅ | no route yet (`/settings/*`) |
| `superadmin-clinics.spec.ts` | `clinicsStore` ✅ | route stub; **blocked on a demo superadmin** |

Every one of these now has a store and unit coverage underneath it, so what's
left in each case is the UI pass. Each spec's header comment carries a TODO
naming its store, its unit test, and anything still blocking it.

To graduate one:

1. Move the spec out of `tests/wip/` into `tests/`.
2. Drop the `.skip`.
3. Replace the placeholder selectors with what the real page renders — treat
   these as **acceptance criteria to satisfy, not markup to match exactly**.
4. If it needs data beyond `tests/wip/fixtures.ts`, promote that into
   `tests/fixtures/` following the `fixtures/` + `helpers/` split above.
5. Delete the now-unused export from `tests/wip/fixtures.ts`.

Not covered by `wip/`, deliberately — these serve the public booking widget and
the pet-owner client, not clinic staff: `public-booking`, `pets`, `clinic_pets`,
`clinic_owners`, `feed`, `profiles/{username}`, `users/claim`, `evaluations`.

### Current coverage gap

`buildDemoUser()` only ever returns a `clinic_admin`, so the **superadmin half of
the role gate is untested** — nothing exercises the Clinics tab, or a superadmin
being kept off `/overview`. A `demoSuperadminLogin` action would close this
cheaply and is worth doing before the clinics page becomes real.
