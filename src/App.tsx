import { useMemo, useRef, useState } from 'react';
import { fullName, openTasks, useCustomers, useSettings } from './crm/store';
import { useDialer } from './crm/dialer';
import { CustomerForm } from './ui/CustomerForm';
import { daysFromToday, go, Icon, StageBadge, useRoute } from './ui/kit';
import { Today } from './pages/Today';
import { Customers } from './pages/Customers';
import { CustomerPage } from './pages/CustomerPage';
import { Pipeline } from './pages/Pipeline';
import { Inventory } from './pages/Inventory';
import { Dialer } from './pages/Dialer';
import { SettingsPage } from './pages/Settings';

const NAV = [
  { path: 'today', label: 'Today', icon: 'today' },
  { path: 'customers', label: 'Customers', icon: 'users' },
  { path: 'pipeline', label: 'Pipeline', icon: 'board' },
  { path: 'inventory', label: 'Inventory', icon: 'car' },
  { path: 'dialer', label: 'Dialer', icon: 'phone' },
];

export function App() {
  const [page = 'today', id] = useRoute();
  const customers = useCustomers();
  const list = useMemo(() => Object.values(customers), [customers]);
  const [adding, setAdding] = useState(false);
  const dialer = useDialer();
  const settings = useSettings();
  const dueToday = list.reduce((n, c) => n + openTasks(c).filter((t) => daysFromToday(t.dueAt) <= 0).length, 0);
  const live = dialer && !['idle', 'ended', 'done'].includes(dialer.phase);

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <img src="/torque-icon.png" alt="" />
          <div>
            Torque CRM
            <small>{settings.name}</small>
          </div>
        </div>
        <nav className="nav stack tight">
          {NAV.map((n) => (
            <a key={n.path} href={`#/${n.path}`} className={page === n.path ? 'active' : ''}>
              <Icon name={n.icon} />
              {n.label}
              {n.path === 'today' && dueToday > 0 && <span className="count">{dueToday}</span>}
              {n.path === 'customers' && <span className="count">{list.length || ''}</span>}
              {n.path === 'dialer' && live && <span className="count pulse live" />}
            </a>
          ))}
        </nav>
        <div className="spacer" />
        <nav className="nav">
          <a href="#/settings" className={page === 'settings' ? 'active' : ''}>
            <Icon name="settings" />
            Settings
          </a>
        </nav>
      </aside>
      <div className="main">
        <header className="topbar">
          <GlobalSearch />
          <div className="grow" />
          <button className="btn primary" onClick={() => setAdding(true)}>
            <Icon name="plus" size={16} /> New customer
          </button>
        </header>
        {page === 'today' && <Today />}
        {page === 'customers' && !id && <Customers />}
        {page === 'customers' && id && <CustomerPage id={id} />}
        {page === 'pipeline' && <Pipeline />}
        {page === 'inventory' && <Inventory />}
        {page === 'dialer' && <Dialer />}
        {page === 'settings' && <SettingsPage />}
      </div>
      {adding && <CustomerForm onClose={() => setAdding(false)} onSaved={(c) => go(`customers/${c.id}`)} />}
    </div>
  );
}

/** Find anyone by name, phone, email or vehicle. */
function GlobalSearch() {
  const customers = useCustomers();
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const box = useRef<HTMLInputElement>(null);
  const hits = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return [];
    const digits = s.replace(/\D/g, '');
    return Object.values(customers)
      .filter((c) =>
        [fullName(c), c.email, c.interest, c.vehicle?.title ?? '', c.vehicle?.stock ?? ''].some((v) => v.toLowerCase().includes(s)) ||
        (digits.length >= 3 && [c.phone, c.altPhone].some((p) => p.replace(/\D/g, '').includes(digits))),
      )
      .slice(0, 8);
  }, [q, customers]);
  const open = (cid: string) => {
    go(`customers/${cid}`);
    setQ('');
    box.current?.blur();
  };
  return (
    <div className="search">
      <Icon name="search" size={16} />
      <input
        ref={box}
        value={q}
        placeholder="Search customers by name, phone, email or vehicle"
        onChange={(e) => (setQ(e.target.value), setSel(0))}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') setSel((n) => Math.min(n + 1, hits.length - 1));
          if (e.key === 'ArrowUp') setSel((n) => Math.max(n - 1, 0));
          if (e.key === 'Enter' && hits[sel]) open(hits[sel].id);
          if (e.key === 'Escape') setQ('');
        }}
      />
      {hits.length > 0 && (
        <div className="search-results">
          {hits.map((c, i) => (
            <button key={c.id} className={i === sel ? 'sel' : ''} onMouseDown={() => open(c.id)}>
              <span>
                <strong>{fullName(c)}</strong> <span className="muted small">{c.phone}</span>
              </span>
              <StageBadge stage={c.stage} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
