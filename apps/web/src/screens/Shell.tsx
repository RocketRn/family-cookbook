import { useTranslation } from 'react-i18next';
import { NavLink, Outlet } from 'react-router-dom';
import { Toast } from '../design/Feedback';
import { useToastStore } from '../state/store';

const TABS = [
  { to: '/', key: 'book', icon: '📖' },
  { to: '/saved', key: 'saved', icon: '🔖' },
  { to: '/profile', key: 'profile', icon: '👤' },
] as const;

export function TabShell() {
  const { t } = useTranslation();
  return (
    <>
      <main className="shell__content">
        <Outlet />
      </main>
      <nav className="tabbar" aria-label={t('app_name')}>
        {TABS.map((tab) => (
          <NavLink key={tab.to} to={tab.to} end className="tabbar__item">
            <span className="tabbar__icon" aria-hidden="true">
              {tab.icon}
            </span>
            <span>{t(`tabs.${tab.key}`)}</span>
          </NavLink>
        ))}
      </nav>
    </>
  );
}

export function PlainShell() {
  return (
    <main className="shell__content" style={{ paddingBottom: 'var(--space-5)' }}>
      <Outlet />
    </main>
  );
}

export function ToastHost() {
  const message = useToastStore((s) => s.message);
  return <Toast message={message} />;
}
