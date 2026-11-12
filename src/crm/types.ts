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
  /** Scheduled automatically: follow-up email #2, #3 or #4 after the first email. */
  seq?: 2 | 3 | 4;
  /** They wrote back: answer them. */
  reply?: boolean;
}

export interface Customer {
  id: string;
  firstName: string;
  lastName: string;
  /** Business they're with (commercial and fleet customers). */
  company?: string;
  /** Their job title there. */
  title?: string;
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
  /** An email to them bounced (Outlook): the address doesn't work. */
  emailBounced?: boolean;
  /** The desk interview: what they'll use it for (Find the right unit). */
  needs?: { use: string; tags: string[]; riders: string; budget: string } | null;
  /** The 3 units Claude suggested from inventory. */
  match?: { at: string; summary: string; picks: { v: VehicleRef; reason: string; inStock: number }[] } | null;
  /** Automatic follow-up emails after the first one (started when it's sent, stopped once you make contact). */
  sequence?: { startedAt: string; stoppedAt?: string | null; reason?: string | null } | null;
  /** When you last looked at their texts (for "unread"). */
  textsReadAt?: string | null;
  createdAt: string;
  updatedAt: string;
  activities: Activity[];
  tasks: Task[];
}

export interface Settings {
  name: string;
  dealership: string;
  /** Where the store is (Claude never places it anywhere else). */
  location: string;
  /** What you sell, in plain words (Claude uses it so drafts don't sound like a car lot). */
  sells: string;
  phone: string;
  /** Your work email (Outlook). */
  email: string;
  /** Where the Email buttons open a new message. */
  emailApp: 'outlook-app' | 'outlook-web';
  /** Added to the end of emails opened in Outlook. Blank (the default): Outlook adds yours. */
  signature: string;
  /** You've set the signature yourself (so the default isn't put back). */
  signatureSet?: boolean;
  /** Claude writes a text with each follow-up too (off: emails only). */
  draftTexts: boolean;
  claudeQuality: 'fast' | 'better';
  voicemail: 'connect' | 'hangup';
  dialDelaySeconds: number;
  /** Days without contact before an open customer shows on "Needs follow-up". */
  followUpDays: number;
  inventoryPage: string;
  /** Only this store's inventory (the site's DealershipName), '' = every store. */
  inventoryLocation: string;
  /** Inventory: every unit, only ones not on Facebook Marketplace yet, or only listed ones. */
  inventoryFacebook?: 'all' | 'not' | 'listed';
}

/**
 * The signature Torque used to add to every email. Not any more: Outlook adds
 * Byron's own, so a saved copy of this is treated as blank.
 */
export const DEFAULT_SIGNATURE = [
  'Byron Green',
  '',
  'Sales Consultant-Florence',
  '',
  '3516 Florence Blvd',
  'Florence, AL  35634',
  '',
  '256.389.8150  Ext. 314',
  '256.263.4614 Fax',
  '',
  'www.shoalsoutdoorsports.com',
].join('\n');

export const DEFAULT_SETTINGS: Settings = {
  name: 'Byron Green',
  dealership: 'Shoals Outdoor Sports',
  location: 'Florence, Alabama (the Shoals)',
  sells: 'powersports and outdoor equipment: ATVs, side-by-sides (UTVs), boats and outboard motors, trailers and riding mowers',
  phone: '(256) 762-0959',
  email: 'byrong@shoalsoutdoorsports.com',
  emailApp: 'outlook-app',
  draftTexts: false,
  signature: '',
  claudeQuality: 'fast',
  voicemail: 'connect',
  dialDelaySeconds: 5,
  followUpDays: 2,
  inventoryPage: '/Inventory/All-Inventory-In-Stock',
  inventoryLocation: 'Shoals Outdoor Sports - Florence',
};
