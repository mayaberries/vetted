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

### New repositories follow a stricter shape than the old ones

The project skill `.claude/skills/create-repository/` (shared verbatim with
kalens, sinapsis and xolo) is the convention for any **new** repository:
SQL against its own table only, plain-ID scoping instead of `requesting_user`,
`*InDB` returns, and domain errors (no `HTTPException`) mapped to HTTP by one
handler. Multi-table workflows, permission rules and `populate_*`-style
hydration move to `app/services/`. `PetProfilesRepository` already looks like
this; the rest don't, and that's a known gap, not a model to copy — see the
skill before adding one, and treat migrating an existing repository as its own
change (kalens calls several of them by name through `scheduling.py`).

New **routes** follow `.claude/skills/create-route/` (same four repos): one
service call per route, loaders and guards as dependencies, `*Public` response
models, error responses declared in the OpenAPI, kebab-case plural paths with
the tenant in the path and no trailing slash. The existing surface mixes
trailing slashes, `snake_case`/kebab segments and token-implied tenancy
(`/clinic_pets/`); that's published and consumed by the admin app, static
sites and CLI, so it stays until a deliberate change moves it. New routes on
an existing router match their neighbours.

New **services** follow `.claude/skills/create-service/`: a per-request class
per domain holding its use cases, rules, transactions and `*Public` hydration,
built by a `get_x_service` dependency. A service uses its own repositories and
other domains' *services*, never their repositories. `AuthService` predates
this and is a stateless helper rather than a service in that sense; it moves
to xolo as is. Today's workflows still live in repositories
(`UsersRepository`, `ClinicsRepository`) and in kalens' public-booking route,
which runs six repositories with no transaction and checks for an overlapping
booking before inserting with nothing to stop a concurrent one.

New **dependencies** follow `.claude/skills/create-dependency/`: each is one of
five kinds (actor resolver → 401, role gate → 403, loader → 404, guard → 403,
builder), raises domain errors, and holds no business rules. Other tenants'
rows are always 404, and clinic-scoped gates route the superuser decision
through one predicate. Today's dependencies drift from this in known ways:
state and uniqueness rules in `check_evaluation_create_permissions` and
kalens' `check_appointment_create_permissions`, "already claimed" checked in
both `get_profile_from_claim_token` and `UsersRepository`, 403 instead of 404
for other owners' pets, other clinics' services and other users' appointments,
and a superuser bypass that `user_can_manage_clinic` has but
`user_can_manage_service` doesn't. Seven of them are kalens' contract surface,
so they change only deliberately.

### The `*Public` convention

**Existing models:** a `*Public` model layers a populated, richer version on
top of `*InDB` — e.g. `AppointmentPublic` adds a full `user: UserPublic` and
`pet: PetProfilePublic` alongside the raw `user_id` and `pet_id`. Each
repository has a `populate_*` method responsible for that hydration. If a field
is missing from an API response, the bug is usually in `populate_*`, not in the
route.

**New models** follow `.claude/skills/create-model/` instead: `*Public` is an
allow-list that never inherits `*InDB` (so a new column isn't exposed by
default), a hydrated relation is its own field next to the ID rather than a
`str | Model` union on one key, inputs extend an `InputModel` with
`extra="forbid"`, timestamps are required and timezone-aware, and hydration is
the service's `to_public`, not a repository's `populate_*`. The existing models
are in `openapi.json` and kalens' contract, so they change only deliberately.
Two of them are traps rather than style: `validate_username` uses `assert`
(gone under `python -O`), and `price` is a `float`.

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

This is the pattern `.claude/skills/library-contract/` generalises for every
library a host adopts (one wiring module per library, under
`app/integrations/` in new hosts; this one keeps its path). When xolo lands,
it provides four of kalens' fields (`users_repository`,
`get_current_active_user`, `get_user_by_username_from_path`,
`get_clinic_from_public_key`): the host configures xolo first and passes its
module's dependencies into kalens' integration. The libraries never import
each other.

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
