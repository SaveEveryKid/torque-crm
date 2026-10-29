import { useMemo } from 'react';
import { fullName, lastContact, openTasks, updateTask, useCustomers, useSettings, useStoredKey } from '../crm/store';
import { DAILY_GOAL, EMPTY_PROGRESS, currentStreak, dayOf, type CardState, type Progress } from '../training/engine';
import { OPEN_STAGES, TASK_LABEL, type Customer, type Task } from '../crm/types';
import { ago, Avatar, daysFromToday, Empty, go, Icon, StageBadge, time, when } from '../ui/kit';

type Due = { c: Customer; t: Task };

export function Today() {
  const customers = useCustomers();
  const settings = useSettings();
  const list = useMemo(() => Object.values(customers), [customers]);
  const now = new Date();

  const tasks: Due[] = list.flatMap((c) => openTasks(c).map((t) => ({ c, t })));
  const due = tasks.filter(({ t }) => t.kind !== 'appointment' && daysFromToday(t.dueAt) <= 0).sort((a, b) => a.t.dueAt.localeCompare(b.t.dueAt));
  const appts = tasks.filter(({ t }) => t.kind === 'appointment' && daysFromToday(t.dueAt) >= -1 && daysFromToday(t.dueAt) <= 6).sort((a, b) => a.t.dueAt.localeCompare(b.t.dueAt));
  const apptsToday = appts.filter(({ t }) => daysFromToday(t.dueAt) === 0);
  const followUp = list
    .filter((c) => OPEN_STAGES.includes(c.stage) && !c.doNotContact && openTasks(c).length === 0)
    .filter((c) => {
      const last = lastContact(c);
      return !last || now.getTime() - new Date(last).getTime() > settings.followUpDays * 86_400_000;
    })
    .sort((a, b) => (lastContact(a) ?? '').localeCompare(lastContact(b) ?? ''));
  const late = due.filter(({ t }) => daysFromToday(t.dueAt) < 0).length;
  const month = now.toISOString().slice(0, 7);
  const soldThisMonth = list.filter((c) => c.stage === 'sold' && c.updatedAt.startsWith(month)).length;
  const hello = now.getHours() < 12 ? 'Good morning' : now.getHours() < 17 ? 'Good afternoon' : 'Good evening';

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>
            {hello}, {settings.name.split(' ')[0]}
          </h1>
          <p>{now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}</p>
        </div>
      </div>

      <BootcampNudge />
      <div className="stats">
        <Stat label="Tasks due" value={due.length} hint={late ? `${late} overdue` : due.length ? 'due today' : 'all caught up'} />
        <Stat label="Appointments today" value={apptsToday.length} hint={`${appts.length} this week`} />
        <Stat label="Need a follow-up" value={followUp.length} hint={`no contact in ${settings.followUpDays}+ days`} />
        <Stat label="Sold this month" value={soldThisMonth} hint={`${list.filter((c) => OPEN_STAGES.includes(c.stage)).length} open deals`} />
      </div>

      <div className="grid two">
        <section className="card">
          <div className="card-head">
            <h2>To do</h2>
            <span className="sub">{due.length ? 'overdue and today' : ''}</span>
          </div>
          {due.length === 0 ? (
            <Empty title="Nothing due">Tasks you schedule on a customer show up here.</Empty>
          ) : (
            <div className="list">
              {due.map(({ c, t }) => (
                <div key={t.id} className="list-item">
                  <input type="checkbox" aria-label="Done" onChange={() => void updateTask(c.id, t.id, { done: true, doneAt: new Date().toISOString() })} />
                  <div className="grow click" onClick={() => go(`customers/${c.id}`)} style={{ cursor: 'pointer' }}>
                    <div className="title">
                      {TASK_LABEL[t.kind]} {fullName(c)}
                    </div>
                    <div className="muted small">{t.title}</div>
                  </div>
                  <span className={`when${daysFromToday(t.dueAt) < 0 ? ' late' : ''}`}>{daysFromToday(t.dueAt) < 0 ? when(t.dueAt) : time(t.dueAt)}</span>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="card">
          <div className="card-head">
            <h2>Appointments</h2>
            <span className="sub">next 7 days</span>
          </div>
          {appts.length === 0 ? (
            <Empty title="No appointments yet">Set one from a customer's page.</Empty>
          ) : (
            <div className="list">
              {appts.map(({ c, t }) => (
                <div key={t.id} className="list-item click" onClick={() => go(`customers/${c.id}`)}>
                  <Avatar first={c.firstName} last={c.lastName} />
                  <div className="grow">
                    <div className="title">{fullName(c)}</div>
                    <div className="muted small">{c.vehicle?.title || c.interest || t.title}</div>
                  </div>
                  <span className={`when${daysFromToday(t.dueAt) < 0 ? ' late' : ''}`}>{when(t.dueAt)}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <section className="card">
        <div className="card-head">
          <h2>Needs a follow-up</h2>
          {followUp.length > 0 && (
            <button className="btn sm" onClick={() => go('dialer')}>
              <Icon name="phone" size={15} /> Call them
            </button>
          )}
        </div>
        {followUp.length === 0 ? (
          <Empty title="Everyone's been touched">Open customers with no contact in {settings.followUpDays}+ days and nothing scheduled show up here.</Empty>
        ) : (
          <div className="list">
            {followUp.slice(0, 25).map((c) => (
              <div key={c.id} className="list-item click" onClick={() => go(`customers/${c.id}`)}>
                <Avatar first={c.firstName} last={c.lastName} />
                <div className="grow">
                  <div className="title">{fullName(c)}</div>
                  <div className="muted small">{c.vehicle?.title || c.interest || c.source || c.phone}</div>
                </div>
                <StageBadge stage={c.stage} />
                <span className="when">last contact {ago(lastContact(c))}</span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: number; hint: string }) {
  return (
    <div className="card stat">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      <div className="hint">{hint}</div>
    </div>
  );
}

/** Today's study: streak, reviews due, progress toward the daily goal. */
function BootcampNudge() {
  const stats = useStoredKey<Omit<Progress, 'cards'>>('training', EMPTY_PROGRESS);
  const cards = useStoredKey<Record<string, CardState>>('trainingCards', {});
  const today = dayOf();
  const p = { ...EMPTY_PROGRESS, ...stats, cards };
  const done = p.days[today] ?? 0;
  const due = Object.values(cards).filter((c) => c.due <= today).length;
  const streak = currentStreak(p, today);
  const finished = done >= DAILY_GOAL;
  return (
    <a className="card boot-nudge" href="#/bootcamp">
      <span className="emoji">{finished ? '✅' : '🔥'}</span>
      <div className="grow">
        <strong>{finished ? `Bootcamp done for today · ${streak} day streak` : streak ? `Keep your ${streak}-day streak alive` : 'Product Bootcamp: start your streak today'}</strong>
        <div className="muted small">
          {done} / {DAILY_GOAL} answered today{due ? ` · ${due} reviews due` : ''}
        </div>
      </div>
      <span className="btn primary sm">{finished ? 'Study more' : done ? 'Keep going' : 'Start'}</span>
    </a>
  );
}
