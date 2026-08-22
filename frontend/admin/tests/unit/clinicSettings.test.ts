import {describe, expect, it} from 'vitest';
import {createAvailabilityStore, createClinicProfileStore} from '../../src/stores/clinicSettings';
import {createClinicsStore} from '../../src/stores/clinics';
import {aClinic, anAvailability, createFakeApi} from './fakeApi';

/** Mirrors tests/wip/clinic-settings.spec.ts and superadmin-clinics.spec.ts. */

describe('clinic profile store', () => {
    it('loads the clinic and saves an edited field', async () => {
        const api = createFakeApi({
            'clinic.update': (patch: any) => aClinic({...patch}),
        });
        const store = createClinicProfileStore(api);

        await store.load();
        expect(store.$clinic.get()?.name).toBe('Acme Vet Clinic');

        await store.save({address: '456 Renewed Ave, CDMX'});
        expect(store.$clinic.get()?.address).toBe('456 Renewed Ave, CDMX');
    });

    it('keeps the loaded clinic when a save is rejected', async () => {
        const store = createClinicProfileStore(
            createFakeApi({
                'clinic.update': () => {
                    throw new Error('Forbidden');
                },
            })
        );
        await store.load();

        await expect(store.save({name: 'Nope'})).rejects.toThrow('Forbidden');
        expect(store.$clinic.get()?.name).toBe('Acme Vet Clinic');
    });
});

describe('availability store', () => {
    it('edits a day locally without hitting the network', async () => {
        const api = createFakeApi();
        const store = createAvailabilityStore(api);
        await store.load();

        store.setDay('tuesday', [{start: '10:00', end: '14:00'}]);

        expect(store.$schedule.get().tuesday).toEqual([{start: '10:00', end: '14:00'}]);
        expect(api.calls).not.toContain('clinic.updateAvailability');
    });

    it('sends the whole week on save, since the PUT is a full replace', async () => {
        // An omitted weekday means "closed" to the backend, not "unchanged" —
        // so a per-day patch would silently close every other day.
        let sent: any = null;
        const store = createAvailabilityStore(
            createFakeApi({
                'clinic.getAvailability': () =>
                    anAvailability({
                        schedule: {
                            monday: [{start: '09:00', end: '17:00'}],
                            wednesday: [{start: '09:00', end: '17:00'}],
                        },
                    }),
                'clinic.updateAvailability': (input: any) => {
                    sent = input;
                    return input;
                },
            })
        );
        await store.load();

        store.setDay('monday', [{start: '08:00', end: '12:00'}]);
        await store.save();

        expect(Object.keys(sent.schedule).sort()).toEqual(['monday', 'wednesday']);
        expect(sent.schedule.monday).toEqual([{start: '08:00', end: '12:00'}]);
        expect(sent.timezone).toBe('America/Mexico_City');
    });

    it('clearDay removes the day entirely, which the backend reads as closed', async () => {
        const store = createAvailabilityStore(createFakeApi());
        await store.load();

        expect(store.$openDays.get()).toEqual(['monday']);
        store.clearDay('monday');

        expect(store.$schedule.get()).not.toHaveProperty('monday');
        expect(store.$openDays.get()).toEqual([]);
    });

    it('tracks the timezone separately from the schedule', async () => {
        const store = createAvailabilityStore(createFakeApi());
        await store.load();

        store.setTimezone('UTC');

        expect(store.$timezone.get()).toBe('UTC');
        expect(store.$schedule.get().monday).toBeTruthy();
    });
});

describe('clinics store (superadmin)', () => {
    it('lists every clinic, sorted by name, and indexes by slug', async () => {
        const store = createClinicsStore(
            createFakeApi({
                'clinics.list': () => [
                    aClinic({id: 'c2', name: 'Northside Animal Hospital', slug: 'northside-animal'}),
                    aClinic({id: 'c1', name: 'Acme Vet Clinic', slug: 'acme-vet'}),
                ],
            })
        );

        await store.load();

        expect(store.$sorted.get().map((c) => c.name)).toEqual([
            'Acme Vet Clinic',
            'Northside Animal Hospital',
        ]);
        expect(store.$bySlug.get()['acme-vet']?.id).toBe('c1');
    });

    it('surfaces the backend refusal when a non-superuser reaches it', async () => {
        const store = createClinicsStore(
            createFakeApi({
                'clinics.list': () => {
                    throw new Error('Only the platform superuser can list every clinic.');
                },
            })
        );

        await store.load();

        expect(store.$state.get()).toBe('error');
        expect(store.$error.get()).toMatch(/superuser/);
    });
});
