import { ReactNode } from 'react';

export type NavItem = { key: string; label: string; visible?: boolean };

export function Shell({
  title,
  subtitle,
  nav,
  current,
  onNavigate,
  userLabel,
  onLogout,
  children
}: {
  title: string;
  subtitle: string;
  nav: NavItem[];
  current: string;
  onNavigate: (key: string) => void;
  userLabel: string;
  onLogout: () => void;
  children: ReactNode;
}) {
  const visibleNav = nav.filter((n) => n.visible !== false);
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">PM</div>
          <div>
            <h1>{title}</h1>
            <p>{subtitle}</p>
          </div>
        </div>
        <div className="nav">
          {visibleNav.map((item) => (
            <button
              key={item.key}
              className={current === item.key ? 'active' : ''}
              onClick={() => onNavigate(item.key)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </aside>
      <main className="content">
        <div className="topbar">
          <div>
            <h1 style={{ margin: 0 }}>{visibleNav.find((n) => n.key === current)?.label || title}</h1>
            <small>{subtitle}</small>
          </div>
          <div className="userbar">
            <div className="avatar">{userLabel?.slice(0, 1).toUpperCase() || 'U'}</div>
            <div>
              <strong>{userLabel}</strong><br />
              <button className="ghost" onClick={onLogout}>Sair</button>
            </div>
          </div>
        </div>
        {children}
      </main>
    </div>
  );
}
