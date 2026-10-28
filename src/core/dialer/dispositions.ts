/** Local call results. Stored in this browser only — NEVER written to eLead. */
export const DISPOSITIONS = {
  CONNECTED_FOLLOW_UP: 'Connected — follow up',
  CONNECTED_APPOINTMENT: 'Connected — appointment',
  CONNECTED_NOT_INTERESTED: 'Connected — not interested',
  CONNECTED_BOUGHT_ELSEWHERE: 'Connected — bought elsewhere',
  CALL_BACK_LATER: 'Call back later',
  WRONG_NUMBER: 'Wrong number',
  NO_ANSWER: 'No answer',
  VOICEMAIL: 'Voicemail',
  BUSY: 'Busy',
  FAILED: 'Call failed',
  INVALID: 'Invalid number',
  SKIP: 'Skipped',
  // Appointments you log yourself (Queue → customer → ADD APPOINTMENT). Not calls.
  APPOINTMENT_FROM_TEXT: 'Appointment — from text follow-up',
  APPOINTMENT_FROM_EMAIL: 'Appointment — from email follow-up',
  APPOINTMENT_FROM_CALL: 'Appointment — from a call',
  APPOINTMENT_OTHER: 'Appointment — other',
} as const;

/** Results logged by hand with ADD APPOINTMENT (they are not call attempts). */
export const MANUAL_APPOINTMENTS = ['APPOINTMENT_FROM_TEXT', 'APPOINTMENT_FROM_EMAIL', 'APPOINTMENT_FROM_CALL', 'APPOINTMENT_OTHER'] as const;
export const isManualAppointment = (r: string) => (MANUAL_APPOINTMENTS as readonly string[]).includes(r);

export type Disposition = keyof typeof DISPOSITIONS;

/** Results a person picks after a conversation. */
export const AFTER_CALL_CHOICES: Disposition[] = [
  'CONNECTED_FOLLOW_UP',
  'CONNECTED_APPOINTMENT',
  'CALL_BACK_LATER',
  'CONNECTED_NOT_INTERESTED',
  'CONNECTED_BOUGHT_ELSEWHERE',
  'WRONG_NUMBER',
  'NO_ANSWER',
  'VOICEMAIL',
  'BUSY',
  'SKIP',
];

export interface CallLogEntry {
  id: string;
  at: string; // ISO time the call (or skip) started
  opportunityId: string;
  name: string;
  phone: string; // display format
  vehicle: string | null;
  source: string | null;
  dateIn: string | null;
  result: Disposition;
  /** Seconds talking with a person (0 if never connected). */
  talkSeconds: number;
  callbackAt: string | null;
  note: string | null;
  /** True when the dialer recorded the result itself (no answer, voicemail, busy…). */
  automatic: boolean;
  /** Manual appointments: when the appointment is. */
  appointmentAt?: string | null;
  /** Appointments: did they show? Set by you on the Follow-ups tab. */
  apptResult?: 'showed' | 'no_show' | null;
  /** Earlier times this appointment was moved from (RESCHEDULED). The appointment still counts once. */
  rescheduledFrom?: string[];
  /** RESCHEDULED with no new time yet: not a no-show, waiting for you to set the new time. */
  needsNewTime?: boolean;
}

export const isAppointment = (r: Disposition) => r === 'CONNECTED_APPOINTMENT' || isManualAppointment(r);
