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
>
> **Unconfirmed, possibly stale:** `connect_to_db` (`app/db/tasks.py`) has
> opened the test `Database` with `force_rollback=True` since `3e9d4df`
> (2026-08-04), and every test enters the app lifespan afresh, which should
> roll each test back. This note was written after that (2026-08-21). Run the
> suite twice against one database to settle it; if it holds, this note, the
> CLAUDE.md trap and the get-or-create / random-window workarounds can go.

New tests follow `.claude/skills/write-tests/` (shared with kalens, sinapsis
and xolo): one kind of test per layer, factories with unique values instead of
named singleton fixtures, per-request `auth_headers(user)` rather than
`create_authorized_client` (which mutates the shared client's headers), and a
separate `committing_db` fixture for race tests, since under `force_rollback`
every query shares one serialised connection and `asyncio.gather` can't
produce real concurrency.

`tests/feed/` is skipped — the Feed feature is dormant, see
[domain.md](domain.md#feed).

### Tests that go through kalens' routes

`tests/appointments/`, `tests/public_booking/` and the availability tests under
`tests/clinics/` call routes that [kalens](architecture.md#scheduling-lives-in-kalens)
owns. Scheduling *rules* — status transitions, overlap/409s, cancellation
reasons, payload validation on kalens' own models — are kalens' to test, and
its suite does. What stays here is what kalens can't see, because its suite
runs against a stand-in host:

- **Contract tests:** one or two per thing `app/api/scheduling.py` hands
  kalens — our repositories, permission dependencies (`user_can_manage_service`,
  `check_clinic_modification_permissions`, `get_service_clinic_id`, …), models,
  and the rate-limit settings. They prove our real implementations satisfy
  what kalens expects.
- **Our own code reached through those routes:** clinic-key resolution
  (`public_auth.py`), `PublicPetInput`'s validator, guest provisioning and
  login refusal, per-clinic pet visibility, default hours on clinic creation.

Before adding a test here, ask which of those two it is. If it's neither, it
belongs in kalens.

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

**The test build uses a non-Secure session cookie.** Astro marks the session
cookie Secure in production builds, and WebKit, unlike Chromium and Firefox,
drops Secure cookies on plain-http `localhost`. Every webkit sign-in used to
bounce back to `/login`. Playwright's `webServer` builds with
`ADMIN_INSECURE_SESSION_COOKIE=1`, which `astro.config.mjs` turns into
`secure: false`. The flag is read at build time, so outside CI
(`reuseExistingServer`) a server you started yourself without it will still
fail webkit. Never set it for a deployed build.

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
