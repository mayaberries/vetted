import {actionsApi} from "../lib/api/actionsApi";
import {createServicesStore} from "./services";
import {createAppointmentsStore} from "./appointments";
import {createApiKeysStore} from "./apiKeys";
import {createClinicsStore} from "./clinics";
import {createAvailabilityStore, createClinicProfileStore} from "./clinicSettings";
import {createToastsStore} from "./toasts";

/**
 * The app's live store instances, wired to the real Astro-Actions API.
 *
 * !! IMPORT THIS FROM CLIENT CODE ONLY !!
 * These are module singletons shared by every concurrent request under
 * `output: "server"` — the same hazard documented in stores/auth.ts. Load them
 * from a Vue `onMounted` or a user interaction, never from `.astro` frontmatter.
 *
 * Importing this module also pulls in `astro:actions`, which only resolves
 * inside an Astro build. Unit tests import the `create*Store` factories directly
 * and pass a fake `AdminApi` — see tests/unit/.
 */

export const servicesStore = createServicesStore(actionsApi);
export const appointmentsStore = createAppointmentsStore(actionsApi);
export const apiKeysStore = createApiKeysStore(actionsApi);
export const clinicsStore = createClinicsStore(actionsApi);
export const clinicProfileStore = createClinicProfileStore(actionsApi);
export const availabilityStore = createAvailabilityStore(actionsApi);
export const toasts = createToastsStore();

export {$currentUser, $activeTab, $visibleTabs, $isSuperadmin, hydrateCurrentUser} from "./auth";
