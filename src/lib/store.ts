/* =========================================================================
   CropSentinel AI — Application store

   Local, persistent, offline. State lives in zustand and is mirrored into
   localStorage so the demonstration survives a page refresh. The reducer-style
   actions below are the only way the UI mutates data, which keeps the CRUD
   contract (Phase 10) in one auditable place.

   `bootstrap()` seeds the demonstration dataset on first run only.
   ========================================================================= */

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type {
  AppNotification,
  ExpertCase,
  Farm,
  FeedbackRecord,
  FollowUp,
  Plot,
  RiskWeights,
  Scan,
  TrapObservation,
} from '../domain/types';
import { buildSeedData } from '../domain/seed';
import type { Lang } from '../domain/types';
import type { WeatherProviderId } from './weather';
import { uid } from './format';
import { DEFAULT_SERVICE_URL, normaliseServiceUrl } from './inferenceClient';
import { registerServiceUrlResolver } from './screening';

export interface StoreState {
  seeded: boolean;
  farms: Farm[];
  plots: Plot[];
  scans: Scan[];
  traps: TrapObservation[];
  cases: ExpertCase[];
  followUps: FollowUp[];
  feedback: FeedbackRecord[];
  notifications: AppNotification[];
  settings: {
    lang: Lang;
    demoMode: boolean;
    weatherProvider: WeatherProviderId;
    /** Base URL of the local inference service that runs the trained models. */
    modelServiceUrl: string;
    riskWeights: RiskWeights;
    currentUser: { name: string; role: string; initials: string };
  };

  /* settings */
  setLang: (lang: Lang) => void;
  setDemoMode: (on: boolean) => void;
  setWeatherProvider: (p: WeatherProviderId) => void;
  setModelServiceUrl: (url: string) => void;
  setWeights: (w: Partial<RiskWeights>) => void;
  setUser: (u: Partial<StoreState['settings']['currentUser']>) => void;

  /* farms */
  addFarm: (f: Omit<Farm, 'id'>) => string;
  updateFarm: (id: string, patch: Partial<Farm>) => void;
  deleteFarm: (id: string) => void;

  /* plots */
  addPlot: (p: Omit<Plot, 'id'>) => string;
  updatePlot: (id: string, patch: Partial<Plot>) => void;
  deletePlot: (id: string) => void;

  /* scans */
  addScan: (s: Omit<Scan, 'id'>) => string;
  updateScan: (id: string, patch: Partial<Scan>) => void;
  deleteScan: (id: string) => void;

  /* traps */
  addTrap: (t: Omit<TrapObservation, 'id'>) => string;
  updateTrap: (id: string, patch: Partial<TrapObservation>) => void;
  deleteTrap: (id: string) => void;

  /* cases */
  addCase: (c: Omit<ExpertCase, 'id'>) => string;
  updateCase: (id: string, patch: Partial<ExpertCase>) => void;
  addFeedback: (f: Omit<FeedbackRecord, 'id'>) => void;

  /* follow-ups */
  addFollowUp: (f: Omit<FollowUp, 'id'>) => string;

  /* notifications */
  pushNotification: (n: Omit<AppNotification, 'id' | 'read'>) => void;
  markAllRead: () => void;

  /* lifecycle */
  resetData: () => Promise<void>;
}

// Marathi is the default farmer-facing language for the Maharashtra deployment;
// English remains selectable and every key falls back to English.
const emptySettings: StoreState['settings'] = {
  lang: 'mr',
  demoMode: true,
  weatherProvider: 'simulated',
  modelServiceUrl: DEFAULT_SERVICE_URL,
  riskWeights: { weather: 30, stage: 12, history: 20, traps: 14, neighbourhood: 10, soil: 6, management: 8 },
  currentUser: { name: 'Demo Officer', role: 'Agriculture Officer (demo)', initials: 'DO' },
};

const safeStorage = createJSONStorage(() => ({
  getItem: (name: string) => {
    try {
      return localStorage.getItem(name);
    } catch {
      return null;
    }
  },
  setItem: (name: string, value: string) => {
    try {
      localStorage.setItem(name, value);
    } catch (e) {
      // Quota exceeded (usually large uploaded images). Keep the app usable and
      // tell the operator rather than silently losing the newest record.
      console.warn('CropSentinel: local storage quota reached, this change was not persisted.', e);
    }
  },
  removeItem: (name: string) => {
    try {
      localStorage.removeItem(name);
    } catch {
      /* ignore */
    }
  },
}));

export const useStore = create<StoreState>()(
  persist(
    (set, get) => ({
      seeded: false,
      farms: [],
      plots: [],
      scans: [],
      traps: [],
      cases: [],
      followUps: [],
      feedback: [],
      notifications: [],
      settings: emptySettings,

      setLang: (lang) => set((s) => ({ settings: { ...s.settings, lang } })),
      setDemoMode: (demoMode) => set((s) => ({ settings: { ...s.settings, demoMode } })),
      setWeatherProvider: (weatherProvider) => set((s) => ({ settings: { ...s.settings, weatherProvider } })),
      setModelServiceUrl: (url) =>
        set((s) => ({ settings: { ...s.settings, modelServiceUrl: normaliseServiceUrl(url) } })),
      setWeights: (w) => set((s) => ({ settings: { ...s.settings, riskWeights: { ...s.settings.riskWeights, ...w } } })),
      setUser: (u) => set((s) => ({ settings: { ...s.settings, currentUser: { ...s.settings.currentUser, ...u } } })),

      addFarm: (f) => {
        const id = uid('farm');
        set((s) => ({ farms: [...s.farms, { ...f, id }] }));
        return id;
      },
      updateFarm: (id, patch) => set((s) => ({ farms: s.farms.map((f) => (f.id === id ? { ...f, ...patch } : f)) })),
      deleteFarm: (id) =>
        set((s) => {
          const plotIds = s.plots.filter((p) => p.farmId === id).map((p) => p.id);
          const scanIds = s.scans.filter((sc) => plotIds.includes(sc.plotId)).map((sc) => sc.id);
          const caseIds = s.cases.filter((c) => plotIds.includes(c.plotId)).map((c) => c.id);
          return {
            farms: s.farms.filter((f) => f.id !== id),
            plots: s.plots.filter((p) => p.farmId !== id),
            scans: s.scans.filter((sc) => !plotIds.includes(sc.plotId)),
            traps: s.traps.filter((t) => !plotIds.includes(t.plotId)),
            cases: s.cases.filter((c) => !plotIds.includes(c.plotId)),
            followUps: s.followUps.filter((f) => !plotIds.includes(f.plotId)),
            feedback: s.feedback.filter((f) => !scanIds.includes(f.scanId) && !caseIds.includes(f.caseId)),
          };
        }),

      addPlot: (p) => {
        const id = uid('plot');
        set((s) => ({ plots: [...s.plots, { ...p, id }] }));
        return id;
      },
      updatePlot: (id, patch) => set((s) => ({ plots: s.plots.map((p) => (p.id === id ? { ...p, ...patch } : p)) })),
      deletePlot: (id) =>
        set((s) => {
          const scanIds = s.scans.filter((sc) => sc.plotId === id).map((sc) => sc.id);
          const caseIds = s.cases.filter((c) => c.plotId === id).map((c) => c.id);
          return {
            plots: s.plots.filter((p) => p.id !== id),
            scans: s.scans.filter((sc) => sc.plotId !== id),
            traps: s.traps.filter((t) => t.plotId !== id),
            cases: s.cases.filter((c) => c.plotId !== id),
            followUps: s.followUps.filter((f) => f.plotId !== id),
            feedback: s.feedback.filter((f) => !scanIds.includes(f.scanId) && !caseIds.includes(f.caseId)),
          };
        }),

      addScan: (sc) => {
        const id = uid('scan');
        set((s) => ({ scans: [{ ...sc, id }, ...s.scans] }));
        return id;
      },
      updateScan: (id, patch) => set((s) => ({ scans: s.scans.map((x) => (x.id === id ? { ...x, ...patch } : x)) })),
      deleteScan: (id) =>
        set((s) => {
          const caseIds = s.cases.filter((c) => c.scanId === id).map((c) => c.id);
          return {
            scans: s.scans.filter((x) => x.id !== id),
            cases: s.cases.filter((c) => c.scanId !== id),
            followUps: s.followUps.filter((f) => f.scanId !== id),
            feedback: s.feedback.filter((f) => f.scanId !== id && !caseIds.includes(f.caseId)),
          };
        }),

      addTrap: (t) => {
        const id = uid('trap');
        set((s) => ({ traps: [{ ...t, id }, ...s.traps] }));
        return id;
      },
      updateTrap: (id, patch) => set((s) => ({ traps: s.traps.map((t) => (t.id === id ? { ...t, ...patch } : t)) })),
      deleteTrap: (id) => set((s) => ({ traps: s.traps.filter((t) => t.id !== id) })),

      addCase: (c) => {
        const id = uid('case');
        set((s) => ({ cases: [{ ...c, id }, ...s.cases] }));
        return id;
      },
      updateCase: (id, patch) => set((s) => ({ cases: s.cases.map((c) => (c.id === id ? { ...c, ...patch } : c)) })),
      addFeedback: (f) => set((s) => ({ feedback: [{ ...f, id: uid('fb') }, ...s.feedback] })),

      addFollowUp: (f) => {
        const id = uid('fu');
        set((s) => ({ followUps: [{ ...f, id }, ...s.followUps] }));
        return id;
      },

      pushNotification: (n) =>
        set((s) => ({
          notifications: [{ ...n, id: uid('ntf'), read: false }, ...s.notifications].slice(0, 40),
        })),
      markAllRead: () => set((s) => ({ notifications: s.notifications.map((n) => ({ ...n, read: true })) })),

      resetData: async () => {
        const settings = get().settings;
        const data = await buildSeedData({ weights: settings.riskWeights, currentUser: settings.currentUser });
        set({ ...data, settings: { ...data.settings, ...settings }, seeded: true });
      },
    }),
    {
      name: 'cropsentinel-ai-v1',
      // v2 carried screening metadata (modelInference, dispositionSource,
      // ruleAssessment) and settings.modelServiceUrl. v3 narrows the data
      // model to cotton + soybean only: a v2 dataset may still reference
      // crops the current model cannot represent, so it is discarded and the
      // app re-seeds deterministically instead of rendering obsolete crop ids.
      version: 3,
      storage: safeStorage,
      // A persisted dataset written before the language list was narrowed to
      // English + Marathi can still carry lang: 'ta'. Marathi is the default,
      // so any value the UI can no longer select is normalised on load instead
      // of leaking into the document and the advisory locale.
      merge: (persisted, current) => {
        const merged = { ...current, ...(persisted as object) } as StoreState;
        if (merged.settings?.lang !== 'en' && merged.settings?.lang !== 'mr') {
          merged.settings = { ...merged.settings, lang: 'mr' };
        }
        return merged;
      },
      partialize: (s) => ({
        seeded: s.seeded,
        farms: s.farms,
        plots: s.plots,
        scans: s.scans,
        traps: s.traps,
        cases: s.cases,
        followUps: s.followUps,
        feedback: s.feedback,
        notifications: s.notifications,
        settings: s.settings,
      }),
    },
  ),
);

// The availability check for the inference-service adapter needs the configured
// URL, and only the store knows it. Registered here, at module load, so the
// adapter never reaches into React.
registerServiceUrlResolver(() => useStore.getState().settings.modelServiceUrl ?? DEFAULT_SERVICE_URL);

/** Seeds the demonstration dataset exactly once. */
export async function bootstrap(): Promise<void> {
  const s = useStore.getState();
  if (s.seeded && s.farms.length) return;
  const settings = s.settings;
  const data = await buildSeedData({ weights: settings.riskWeights, currentUser: settings.currentUser });
  useStore.setState({ ...data, settings: { ...data.settings, ...settings }, seeded: true });
}
