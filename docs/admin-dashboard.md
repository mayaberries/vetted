# Admin dashboard (`frontend/admin/`)

The Astro SSR dashboard clinic staff and the platform superuser sign into. It is
an HTTP client of the backend like everything else — it never touches the
database.

```
Astro 7, output: "server", @astrojs/node (standalone)   — runs as a Node process
Vue 3 islands + nanostores                              — the interactive bits
Tailwind v4 via @tailwindcss/vite                       — @theme in global.css
Playwright                                              — tests
```

## Request lifecycle

```
src/middleware.ts        session cookie → context.locals.user, then two guards:
                           1. not signed in + not a public path  → /login
                           2. signed in but wrong role for this tab → their landing tab
        ↓
src/pages/*.astro        reads Astro.locals.user, passes it down as a prop
        ↓
src/layout/AdminLayout.astro   chrome + <AdminNav client:load>
```

Session storage is Astro's built-in session driver, configured by the Node
adapter (filesystem-backed in dev). `src/lib/session.ts`'s `requireSession()`
exists to turn "no session driver configured" into a clear error instead of a
confusing `undefined`.

Writes to the session happen only in **Astro Actions** (`src/actions/index.ts`):
`login`, `logout`, `demoLogin`. `login` exchanges email/password for a JWT at
`POST /users/login/token`, then immediately fetches `/users/me/` to build the
`SessionUser`.

> The backend's login endpoint takes an OAuth2 form with a **`username`** field,
> not `email` — the action posts the email address under the `username` key. This
> looks like a bug at the call site and isn't.

## Routing and the role gate

`src/lib/nav.ts` is the single tab registry. Each tab's `role` does double duty:
it decides **who sees the tab in the nav** *and* **who may land on its URL**.
Keeping both readings in one table is the whole point — a tab hidden from the nav
but reachable by typing its URL is exactly the bug this prevents.

| Tab | Path | Visible to |
|---|---|---|
| Clinics | `/clinics` | superadmin |
| Overview | `/overview` | clinic_admin |
| Appointments | `/appointments` | clinic_admin |
| Services | `/services` | clinic_admin |
| API Keys | `/api-keys` | clinic_admin |
| Website | `/website` | clinic_admin |
| Account | `/account` | both |

`/` is not a tab — it redirects to whichever tab the role starts on
(`landingPathFor()`), so `login.astro` and the middleware can both send people to
a plain `/` without knowing the role. `/login` and `/onboarding` are the public
paths. Anything `tabForPath()` doesn't recognize falls through to Astro's 404
rather than being redirected.

Most of these pages are still `TabStub` placeholders. Their acceptance criteria
are already written as skipped specs — see [testing.md](testing.md).

> ⚠️ **The role gate is a UI guard, not the security boundary.** Nothing stops a
> signed-in clinic admin from calling `GET /api/clinics/` directly. Every
> endpoint still has to enforce `is_superuser`/role server-side.

## nanostores: never `.set()` from server code

**This is the single most important rule in this app, and it is not obvious.**

Nanostores atoms are module-level singletons. Under `output: "server"` the module
is instantiated **once per Node process and shared by every concurrent request**.
A `.set($currentUser)` in `.astro` frontmatter or in middleware would let one
visitor's session data render into another visitor's page — a real auth leak, not
a theoretical one.

So `src/stores/auth.ts` confines every write to `hydrateCurrentUser()`, which is
only ever called from a Vue `onMounted` — a lifecycle hook that does not run
during SSR. The server's copy of those stores stays permanently `null`, which is
exactly what we want.

The pattern for any new island that needs the user:

```
SSR      → gets the user through props (Astro.locals.user → <Component user={…}>)
Client   → onMounted fills the store; later islands read the store, no prop-drilling
Render   → storeUser.value ?? props.user     // identical before and after hydration
```

That `??` fallback is what keeps the server markup and the hydrated markup
identical — no mismatch, no flash of empty nav. `AdminNav.vue` is the reference
implementation; copy its shape.

## The data layer

The browser never holds the JWT. Instead of fetching the backend directly, the
client calls **Astro Actions**, which run on the server where the session lives:

```
Vue island / page
      ↓  calls a store method
src/stores/*.ts            client-side cache + optimistic updates (nanostores)
      ↓  calls the AdminApi port
src/lib/api/adminApi.ts    the interface — no token in any signature
src/lib/api/actionsApi.ts  the real implementation, unwraps Astro's {data, error}
      ↓
src/actions/index.ts       runs on the server; attaches the JWT from the session
src/lib/backendFetch.ts    the ONLY place the token is read for outbound calls
      ↓
backend API
```

The `AdminApi` port exists for a second reason: each store is a
`createXStore(api)` factory, so unit tests pass a fake instead of standing up
Astro's virtual modules. `src/stores/index.ts` wires the live instances —
**import that from client code only**, since the instances are module singletons
subject to the SSR rule above.

| Store | Backs | Notes |
|---|---|---|
| `servicesStore` | `/api/services/` | list, create, update, remove |
| `appointmentsStore` | `/api/services/{id}/appointments/` | fans out across services — see below |
| `apiKeysStore` | `/api/clinics/{id}/api-keys/` | revoke marks inactive, doesn't delete the row |
| `clinicsStore` | `GET /api/clinics/` | superadmin only |
| `clinicProfileStore` | `/api/clinics/{id}/` | |
| `availabilityStore` | `/api/clinics/{id}/availability/` | whole-week replace |
| `toasts` | — | transient UI feedback |

All of them build on `createAsyncStore` / `createCollectionStore`, which give
every store the same two behaviours: **concurrent `load()` calls share one
request**, and **stale responses are discarded** (a slow first load can't
overwrite a fast reload's fresher data).

### Two constraints the stores encode

**Cancelling may produce `declined`, not `cancelled`.** `cancel(id, reason?)`
takes an optional reason, but the *resulting status* is the backend's call —
cancelling a `requested` appointment declines it. The store upserts whatever
comes back rather than assuming; UI code must read the returned status too.

**There is no clinic-wide appointments endpoint.** The backend only offers
`GET /api/services/{service_id}/appointments/`, so `appointmentsStore` lists the
clinic's services and fans out one request per service. That N+1 lives in one
place on purpose — it's the first thing to delete if the backend grows
`GET /api/clinics/{id}/appointments/`. The fan-out uses `allSettled`, so one
failing service degrades to `$partialFailure` instead of blanking the page.

**Availability PUT is a full replace, not a per-day patch.** The backend's own
schema says an omitted weekday means *closed*, not *unchanged*. So
`availabilityStore` holds the whole week locally, `setDay`/`clearDay` don't touch
the network, and `save()` sends everything.

## Demo mode

The sign-in page has a **"Demo · Clinic admin"** button (the `demoLogin` action)
that seeds a fake session from `src/lib/demoData.ts` — no backend needed. It's
how the Playwright suite runs without an API or database.

Every data action branches on `user.isDemo` first. Demo *reads* return that
seed, which uses the **real wire shapes** from `lib/api/types.ts` so store and
component code is identical in demo and live mode. Demo *writes* echo back a
plausible object without persisting, and the store applies it optimistically —
server-side demo state would be a process-wide singleton shared by every
visitor, the same hazard as the stores themselves. So demo edits live in one
browser session and vanish on reload, which is the intended behaviour.

> `buildDemoUser()` always returns a **`clinic_admin`**. There is no demo
> superadmin, which is why the superadmin half of the role gate (the Clinics tab;
> a superadmin being kept off `/overview`) is currently untested. Adding a
> `demoSuperadminLogin` action would close that cheaply.

## The onboarding wizard

`/onboarding` is a public, multi-step signup flow (account → clinic → services →
review → launch). It's deliberately **vanilla JS, not Vue** — it predates the
islands work. Logic lives in `src/lib/onboarding/*`, with mutable wizard state in
a plain object in `state.js`. Don't confuse that with the nanostores auth state;
they solve different problems and shouldn't be merged.

It has its own demo mode (`demoBackend.js`) that swaps every backend call for a
mocked response, separate from the session-level demo login above.

> **Known backend gap the wizard runs into:** `POST /users/` always registers a
> `client`-role account, but creating a clinic requires `clinic_admin`. There is
> no self-service HTTP path to register as a clinic admin yet, so a real (non-demo)
> onboarding run fails at the clinic step unless the account is promoted out of
> band. The wizard surfaces this in its error copy (`launch.js`).

## Styling and design tokens

Colors and fonts for the admin app live in `src/styles/global.css` under
Tailwind v4's `@theme` block. Both `.astro` and `.vue` files are scanned by
Tailwind's automatic content detection.

> **Drift worth knowing about:** `frontend/shared/design-tokens.mjs` calls itself
> the "single source of truth" for tokens across every Astro project, but that's
> no longer true. `frontend/template` doesn't import it at all; `frontend/admin`
> imports only `googleFontsHref` from it and defines its real colors in
> `global.css`; and `docs/proto/theme-config.js` keeps a third hand-copied set.
> The same hex values are currently maintained in three places. Its `colors` and
> `fontFamily` exports are effectively dead code.

## Layout of the source tree

```
src/actions/index.ts       Astro Actions — the whole data layer; the only place
                           the session is written and the JWT is attached
src/components/            Vue islands (.vue) and Astro components (.astro)
src/layout/                AdminLayout.astro — the signed-in chrome
src/lib/api/types.ts       wire types mirroring docs/openapi.json
src/lib/api/adminApi.ts    the port stores talk to (no token in any signature)
src/lib/api/actionsApi.ts  the real implementation, over astro:actions
src/lib/backendFetch.ts    server-only; reads the JWT from the session
src/lib/auth.ts            SessionUser type
src/lib/nav.ts             tab registry + role gate (imported by server AND client)
src/lib/session.ts         requireSession() guard
src/lib/demoData.ts        demo session + seed data in real wire shapes
src/lib/onboarding/        the vanilla-JS wizard
src/middleware.ts          auth + role guards
src/pages/                 routes
src/stores/                nanostores — read the warning above before touching
  createAsyncStore.ts      the shared async primitive
  index.ts                 live instances (client-only import)
tests/                     Playwright specs (*.spec.ts)
tests/unit/                vitest store tests (*.test.ts)
```
