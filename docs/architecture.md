# Architecture

## Three deployables, one API

```
backend/                  FastAPI + PostgreSQL. The only thing that touches the DB.
                          Serves three auth surfaces (below).
   ▲       ▲       ▲
   │       │       │  HTTP only — nothing else imports the backend's Python
   │       │       │
   │       │       └── backend/cli/      Typer admin CLI. A pure HTTP client of
   │       │                             this same API. Cross-tenant operations
   │       │                             + drives the static-site generator.
   │       │
   │       └────────── frontend/admin/   Astro SSR dashboard for clinic staff and
   │                                     the platform superuser. Server-rendered,
   │                                     session-cookie auth. Runs as a Node process.
   │
   └────────────────── frontend/sites/<slug>/   Plain static HTML/CSS/JS, one folder
                                     per clinic, built from frontend/template/.
                                     Talks to the public booking API from the
                                     browser using a publishable key baked in at
                                     build time.
```

The rule that keeps this honest: **only `backend/` touches the database.** The
CLI and both frontends are HTTP clients, which is why the CLI works unmodified
against local, staging, or production.

Deeper dives: [admin dashboard](admin-dashboard.md) ·
[static sites](static-sites.md) · [admin CLI](admin-cli.md)

## Three authentication surfaces

| Surface | Auth | Who uses it |
|---|---|---|
| Staff/admin API (`/clinics`, `/services`, `/pets`, `/clinic_pets`, availability `PUT`, appointment confirm/cancel) | JWT bearer token | Logged-in clinic staff/admins |
| Public booking API (`/public/...`) | `X-Clinic-Key` header (`pk_live_…` / `pk_test_…`) | Anonymous visitors, via the widget on a clinic's own site |
| Platform-operator surface (`GET /clinics/`, plus superuser bypass on the two above) | JWT bearer token with `is_superuser = true` | The single platform superuser, mainly via the admin CLI |

The public key is a publishable-style credential (Stripe `pk_`-style) — safe to
ship in client-side JS. Scoped to one clinic, rate-limited independently per key
and per IP, revocable without touching any other key the clinic holds.

`is_superuser` is **orthogonal to `role`**, not a value of it. It's a
platform-operator flag that bypasses "only this clinic's own admin" scoping, and
the DB enforces at most one (`ix_users_single_superuser`, a partial unique index).

## Backend layering

```
app/api/routes/          FastAPI path operations. Thin — delegate to repositories.
app/api/dependencies/    Permission checks, path-param resolution, auth guards.
app/db/repositories/     ALL database access. Raw SQL via `databases`. One class per domain.
app/models/              Pydantic v2 models: *Create / *InDB / *Public / *Update.
app/db/migrations/       Alembic revisions.
app/api/scheduling.py    The one place this app is wired into kalens (below).
app/core/                Config, settings.
app/services/            Cross-cutting logic that isn't a repository.
cli/                     Typer admin CLI. Talks to the API over HTTP only.
```

### The `*Public` convention

A `*Public` model layers a populated, richer version on top of `*InDB` — e.g.
`AppointmentPublic` adds a full `user: UserPublic` and `pet: PetProfilePublic`
alongside the raw `user_id` and `pet_id`. Each repository has a `populate_*`
method responsible for that hydration. If a field is missing from an API
response, the bug is usually in `populate_*`, not in the route.

### Organized by domain scope, not one-file-per-table

The grouping principle is the domain a piece of logic *serves*, regardless of
whether that maps to one table, several, or a slice of one —
public booking (now kalens' `api/routes/public_booking.py`) deliberately spans
services + pets + appointments + owners, because that's one coherent surface.

Current state of that reorganization:

| Layer | Status |
|---|---|
| `app/models/` | ✅ grouped (`auth/`, `profiles/`, `clinics/`, `services/`, `appointments/`) |
| `app/api/routes/` | ✅ grouped (`auth/`, `clinics/`, `appointments/`, `profiles/`) |
| `tests/` | ✅ grouped (`appointments/`, `clinics/`, `pets/`, `public_booking/`, …) |
| `app/db/repositories/` | ❌ still flat |
| `app/api/dependencies/` | ❌ still flat |

## Scheduling lives in kalens

Appointments, clinic availability and public booking were extracted into
[kalens](https://github.com/mayaberries/kalens), pinned by git tag in
`backend/requirements.in`. Their routes, dependencies, repositories, models and
rate limiter are no longer in this repo; users, clinics, services, pets,
evaluations and the feed still are. The URLs, schemas and tables didn't change —
`docs/openapi.json` is byte-identical across the switch.

**`app/api/scheduling.py` is the only wiring point.** It hands kalens our
repositories, auth/permission dependencies and models, and gets back `appts`,
which carries the routers the route packages mount and everything else the rest
of the app needs. Two rules follow:

- **Take dependencies off `appts`, never rebuild them.** FastAPI shares a
  dependency within a request only when it's the same function object, so a
  re-derived `get_appointment_by_id_from_path` loads the appointment twice
  (see `app/api/dependencies/evaluations.py`).
- **Import `AppointmentPublic` / `PublicAppointmentCreate` from
  `app.api.scheduling`,** not from kalens. Those subclasses narrow kalens'
  loosely typed fields back to our models; they're what the routes return and
  what tests must compare against.

Importing `scheduling.py` installs the integration as a side effect, so it must
not import any route module — the route packages import it.

**Changing scheduling behavior means changing kalens,** tagging a release, and
bumping the pin here. Its known gaps came along with it (appointments complete
only via an evaluation; overlap is only checked against confirmed appointments)
— see the [roadmap](roadmap.md).

### Migrations: ours create the tables, kalens' is only stamped

Our Alembic chain still creates the `appointments` and `clinic_availability`
tables. kalens ships its own chain (version table `kalens_alembic_version`,
reachable as `alembic -n kalens` via the `[kalens]` section of
`backend/alembic.ini`), but here it is **stamped, never upgraded** — running it
would try to create tables that already exist. `make upgrade-db` and the test
fixture both stamp it after our upgrade.

kalens' `env.py` can't build the URL from `POSTGRES_*` the way ours does, nor
add the `_test` suffix, so callers hand it one: the Makefile sets
`KALENS_DATABASE_URL`, the test fixture sets `sqlalchemy.url`.

If a kalens release adds a revision, mirror it as a revision in our chain, then
re-stamp. kalens' `make compare-schema` (run from a kalens checkout next to this
one) diffs the two chains' resulting schemas and is how to confirm they still
agree; `make compare-openapi` does the same for the API surface.

## Known drift risk: duplicated permission checks

Some permission rules exist in **two** places on purpose:

- `app/api/dependencies/` — stops a request before it reaches a route
- `app/db/repositories/` — defense in depth, doesn't trust that the dependency
  was wired correctly

This has drifted for real once already: `create_key_for_clinic` / `revoke_key`
in `ClinicAPIKeysRepository` kept a stale copy of the admin check after the
dependency layer was updated.

**When you change a permission rule, grep for the condition across both
`dependencies/` and `db/repositories/`.** Do not assume either file is
authoritative. For appointments and availability, the two layers are in kalens
(`api/dependencies/` and `db/`), and some of their checks call back into ours
(`user_can_manage_service`, `check_clinic_modification_permissions`, …) through
`scheduling.py` — so a rule there can span both repos.

## A note on polish

Not every part of the app is at the same level of polish. When something looks
inconsistent between layers, it is far more likely to be a part that hasn't been
touched in the current refactor pass than an intentional decision. Check the
[roadmap](roadmap.md) before treating an inconsistency as load-bearing.
