import type { ActivityChannel, ActivityDirection } from '../core/types/schema';

/** Where a customer is in the deal. */
export type Stage = 'new' | 'contacted' | 'appointment' | 'showed' | 'working' | 'sold' | 'lost';

export const STAGES: { id: Stage; label: string }[] = [
  { id: 'new', label: 'New' },
  { id: 'contacted', label: 'Contacted' },
  { id: 'appointment', label: 'Appointment' },
  { id: 'showed', label: 'Showed' },
  { id: 'working', label: 'Working deal' },
  { id: 'sold', label: 'Sold' },
  { id: 'lost', label: 'Lost' },
];
export const STAGE_LABEL = Object.fromEntries(STAGES.map((s) => [s.id, s.label])) as Record<Stage, string>;
export const OPEN_STAGES: Stage[] = ['new', 'contacted', 'appointment', 'showed', 'working'];

/** A unit from the dealer's inventory, attached to a customer. */
export interface VehicleRef {
  id: string;
  title: string;
  stock: string | null;
  vin: string | null;
  price: number | null;
  image: string | null;
  url: string | null;
}

/** One thing that happened: a text, call, email, visit or note. Newest first on the customer. */
export interface Activity {
  id: string;
  at: string;
  channel: ActivityChannel;
  direction: ActivityDirection;
  /** e.g. "Left voicemail", "Appointment set". */
  outcome: string | null;
  text: string;
  /** Came from an import (eLead history) rather than typed here. */
  imported?: boolean;
}

export type TaskKind = 'call' | 'text' | 'email' | 'appointment' | 'todo';

export const TASK_LABEL: Record<TaskKind, string> = {
  call: 'Call',
  text: 'Text',
  email: 'Email',
  appointment: 'Appointment',
  todo: 'To-do',
};

export interface Task {
  id: string;
  kind: TaskKind;
  dueAt: string;
  title: string;
  done: boolean;
  doneAt?: string | null;
  /** Appointments: did they show? */
  result?: 'showed' | 'no_show' | null;
}

export interface Customer {
  id: string;
  firstName: string;
  lastName: string;
  phone: string;
  altPhone: string;
  email: string;
  address: string;
  source: string;
  stage: Stage;
  /** What they're shopping for, in words ("2024 Grizzly 700, green"). */
  interest: string;
  /** A specific unit from inventory. */
  vehicle: VehicleRef | null;
  trade: string;
  notes: string;
  doNotText: boolean;
  doNotContact: boolean;
  createdAt: string;
  updatedAt: string;
  activities: Activity[];
  tasks: Task[];
}

export interface Settings {
  name: string;
  dealership: string;
  phone: string;
  claudeQuality: 'fast' | 'better';
  voicemail: 'connect' | 'hangup';
  dialDelaySeconds: number;
  /** Days without contact before an open customer shows on "Needs follow-up". */
  followUpDays: number;
  inventoryPage: string;
}

export const DEFAULT_SETTINGS: Settings = {
  name: 'Byron Green',
  dealership: 'Shoals Outdoor Sports',
  phone: '',
  claudeQuality: 'fast',
  voicemail: 'connect',
  dialDelaySeconds: 5,
  followUpDays: 2,
  inventoryPage: '/Inventory/All-Inventory-In-Stock',
};
