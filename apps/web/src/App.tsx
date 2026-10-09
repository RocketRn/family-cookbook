import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { getMe, type Me } from './api/endpoints';
import { Button } from './design/Button';
import { EmptyState } from './design/Feedback';
import { errorMessage } from './errors';
import { readManualLanguage, resolveLanguage, setLanguage } from './i18n';
import { bookQuery } from './queries';
import { BookScreen } from './screens/BookScreen';
import { JoinScreen } from './screens/JoinScreen';
import { LinkRecipeScreen } from './screens/LinkRecipeScreen';
import { Onboarding } from './screens/Onboarding';
import { ProfileScreen } from './screens/ProfileScreen';
import { RecipeScreen } from './screens/RecipeScreen';
import { SavedScreen } from './screens/SavedScreen';
import { PlainShell, TabShell, ToastHost } from './screens/Shell';
import { initTelegram } from './telegram/sdk';
import { parseStartParam, routeForTarget } from './telegram/startParam';
import { useBackButton } from './telegram/useBackButton';

type Boot =
  | { status: 'loading' }
  | { status: 'outside' }
  | { status: 'error'; error: unknown }
  | { status: 'ready'; me: Me };

/** Boots Telegram (real or dev mock), signs in via GET /me, applies the language, follows start_param. */
function useBoot(): { boot: Boot; retry: () => void } {
  const navigate = useNavigate();
  const [boot, setBoot] = useState<Boot>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setBoot({ status: 'loading' });
      const rt = await initTelegram();
      if (cancelled) return;
      if (!rt) return setBoot({ status: 'outside' });
      try {
        const me = await getMe();
        if (cancelled) return;
        await setLanguage(
          resolveLanguage({
            manual: readManualLanguage(),
            server: me.ui_lang,
            tgCode: rt.webApp.initDataUnsafe.user?.language_code,
          }),
        );
        const target = parseStartParam(rt.webApp.initDataUnsafe.start_param);
        const route = target && routeForTarget(target);
        if (route && attempt === 0) navigate(route, { replace: true });
        setBoot({ status: 'ready', me });
      } catch (error) {
        if (!cancelled) setBoot({ status: 'error', error });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [attempt, navigate]);

  return { boot, retry: () => setAttempt((n) => n + 1) };
}

function BookTab({ me: _me }: { me: Me }) {
  const book = useQuery(bookQuery);
  const { t } = useTranslation();
  if (book.isLoading)
    return (
      <p className="hint" role="status">
        {t('common.loading')}
      </p>
    );
  if (book.isError) return <Button onClick={() => book.refetch()}>{t('common.retry')}</Button>;
  if (!book.data) return <Onboarding />;
  return <BookScreen bookTitle={book.data.title} />;
}

function Ready({ me }: { me: Me }) {
  useBackButton();
  return (
    <>
      <Routes>
        <Route element={<TabShell />}>
          <Route path="/" element={<BookTab me={me} />} />
          <Route path="/saved" element={<SavedScreen />} />
          <Route path="/profile" element={<ProfileScreen me={me} />} />
        </Route>
        <Route element={<PlainShell />}>
          <Route path="/recipe/:id" element={<RecipeScreen />} />
          <Route path="/join/:code" element={<JoinScreen />} />
          <Route path="/r/:token" element={<LinkRecipeScreen />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <ToastHost />
    </>
  );
}

export function App() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { boot, retry } = useBoot();

  return (
    <div className="shell">
      {boot.status === 'loading' && (
        <p className="hint center" role="status">
          {t('boot.signing_in')}
        </p>
      )}
      {boot.status === 'outside' && (
        <EmptyState icon={'✈️'} title={t('boot.outside_title')} text={t('boot.outside_text')} />
      )}
      {boot.status === 'error' && (
        <EmptyState
          icon={'⚠️'}
          title={t('boot.failed_title')}
          text={`${errorMessage(t, boot.error)} ${t('boot.failed_text')}`}
          action={
            <Button
              onClick={() => {
                void qc.invalidateQueries();
                retry();
              }}
            >
              {t('common.retry')}
            </Button>
          }
        />
      )}
      {boot.status === 'ready' && <Ready me={boot.me} />}
    </div>
  );
}
