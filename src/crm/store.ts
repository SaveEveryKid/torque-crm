import { useEffect, useState } from 'react';
import { kv } from '../core/storage/kv';
import { normalizeUsPhone } from '../core/analysis/phone';
import { DEFAULT_SETTINGS, type Activity, type Customer, type Settings, type Stage, type Task } from './types';

/**
 * Your CRM data, on this computer only (IndexedDB through kv). Nothing here
 * is sent anywhere; Claude only sees one customer at a time, when you ask
 * for a draft.
 */
const CUSTOMERS = 'customers';
const SETTINGS = 'settings';

export type CustomerMap = Record<string, Customer>;

const now = () => new Date().toISOString();
export const newId = () => crypto.randomUUID();

export async function getCustomers(): Promise<CustomerMap> {
  return ((await kv.get(CUSTOMERS))[CUSTOMERS] as CustomerMap | undefined) ?? {};
}

export async function getCustomer(id: string): Promise<Customer | null> {
  return (await getCustomers())[id] ?? null;
}

async function saveAll(m: CustomerMap) {
  await kv.set({ [CUSTOMERS]: m });
}

export function blankCustomer(patch: Partial<Customer> = {}): Customer {
  const t = now();
  return {
    id: newId(),
    firstName: '',
    lastName: '',
    phone: '',
    altPhone: '',
    email: '',
    address: '',
    source: '',
    stage: 'new',
    interest: '',
    vehicle: null,
    trade: '',
    notes: '',
    doNotText: false,
    doNotContact: false,
    createdAt: t,
    updatedAt: t,
    activities: [],
    tasks: [],
    ...patch,
  };
}

/** "(256) 555-2964" when it's a real US number, otherwise what was typed. */
export function formatPhone(raw: string): string {
  const n = normalizeUsPhone(raw);
  return n.ok ? n.display : raw.trim();
}

export async function addCustomer(c: Customer): Promise<Customer> {
  const m = await getCustomers();
  const saved = { ...c, phone: formatPhone(c.phone), altPhone: c.altPhone ? formatPhone(c.altPhone) : '' };
  m[saved.id] = saved;
  await saveAll(m);
  return saved;
}

export async function addCustomers(list: Customer[]): Promise<void> {
  const m = await getCustomers();
  for (const c of list) m[c.id] = c;
  await saveAll(m);
}

export async function updateCustomer(id: string, patch: Partial<Customer> | ((c: Customer) => Partial<Customer>)): Promise<void> {
  const m = await getCustomers();
  const c = m[id];
  if (!c) return;
  const p = typeof patch === 'function' ? patch(c) : patch;
  m[id] = { ...c, ...p, updatedAt: now() };
  await saveAll(m);
}

export async function deleteCustomer(id: string): Promise<void> {
  const m = await getCustomers();
  delete m[id];
  await saveAll(m);
}

/** Moving to Appointment / Showed / Sold etc. is logged on the timeline. */
export async function setStage(id: string, stage: Stage, label: string): Promise<void> {
  await updateCustomer(id, (c) =>
    c.stage === stage ? {} : { stage, activities: [activity({ channel: 'NOTE', direction: 'INTERNAL', outcome: 'Stage', text: `Moved to ${label}` }), ...c.activities] },
  );
}

export function activity(a: Omit<Activity, 'id' | 'at'> & { at?: string }): Activity {
  return { id: newId(), at: a.at ?? now(), ...a };
}

export async function logActivity(id: string, a: Omit<Activity, 'id' | 'at'> & { at?: string }): Promise<void> {
  const entry = activity(a);
  await updateCustomer(id, (c) => ({
    activities: [entry, ...c.activities].sort((x, y) => y.at.localeCompare(x.at)),
    // First outbound contact moves a New customer to Contacted.
    ...(c.stage === 'new' && entry.direction === 'OUTBOUND' ? { stage: 'contacted' as Stage } : {}),
  }));
}

export async function deleteActivity(id: string, activityId: string): Promise<void> {
  await updateCustomer(id, (c) => ({ activities: c.activities.filter((a) => a.id !== activityId) }));
}

export async function addTask(id: string, t: Omit<Task, 'id' | 'done'>): Promise<void> {
  await updateCustomer(id, (c) => ({
    tasks: [...c.tasks, { ...t, id: newId(), done: false }],
    ...(t.kind === 'appointment' && ['new', 'contacted'].includes(c.stage) ? { stage: 'appointment' as Stage } : {}),
  }));
}

export async function updateTask(id: string, taskId: string, patch: Partial<Task>): Promise<void> {
  await updateCustomer(id, (c) => ({ tasks: c.tasks.map((t) => (t.id === taskId ? { ...t, ...patch } : t)) }));
}

export async function deleteTask(id: string, taskId: string): Promise<void> {
  await updateCustomer(id, (c) => ({ tasks: c.tasks.filter((t) => t.id !== taskId) }));
}

export async function getSettings(): Promise<Settings> {
  return { ...DEFAULT_SETTINGS, ...((await kv.get(SETTINGS))[SETTINGS] as Partial<Settings> | undefined) };
}

export async function saveSettings(patch: Partial<Settings>): Promise<void> {
  await kv.set({ [SETTINGS]: { ...(await getSettings()), ...patch } });
}

/** Re-render when any of these stored keys change. */
function useStored<T>(keys: string[], read: () => Promise<T>, initial: T): T {
  const [v, setV] = useState<T>(initial);
  useEffect(() => {
    let live = true;
    const load = () => void read().then((x) => live && setV(x));
    load();
    const off = kv.onChange((changed) => changed.some((k) => keys.includes(k)) && load());
    return () => {
      live = false;
      off();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return v;
}

export const useCustomers = () => useStored([CUSTOMERS], getCustomers, {});
export const useSettings = () => useStored([SETTINGS], getSettings, DEFAULT_SETTINGS);
export const useStoredKey = <T,>(key: string, fallback: T) => useStored([key], async () => ((await kv.get(key))[key] as T | undefined) ?? fallback, fallback);

export const fullName = (c: Pick<Customer, 'firstName' | 'lastName'>) => `${c.firstName} ${c.lastName}`.trim() || 'No name';

/** Last time you reached out (text, call, email, visit), if ever. */
export function lastContact(c: Customer): string | null {
  return c.activities.find((a) => a.direction === 'OUTBOUND' || a.channel === 'APPOINTMENT')?.at ?? null;
}

export function lastCustomerMessage(c: Customer): Activity | null {
  return c.activities.find((a) => a.direction === 'INBOUND') ?? null;
}

export const openTasks = (c: Customer) => c.tasks.filter((t) => !t.done).sort((a, b) => a.dueAt.localeCompare(b.dueAt));
