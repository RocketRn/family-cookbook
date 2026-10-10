import { useQuery, useQueryClient } from '@tanstack/react-query';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { getMe, type Me } from './api/endpoints';
import { Button } from './design/Button';
import { EmptyState, ErrorState, Loading } from './design/Feedback';
import { errorMessage } from './errors';
import { readManualLanguage, resolveLanguage, setLanguage } from './i18n';
import { bookQuery } from './queries';
import { CookScreen } from './cook/CookScreen';
import { BookScreen } from './screens/BookScreen';
import { JoinScreen } from './screens/JoinScreen';
import { LinkRecipeScreen } from './screens/LinkRecipeScreen';
import { Onboarding } from './screens/Onboarding';
import { ProfileScreen } from './screens/ProfileScreen';
import { EditorScreen } from './editor/EditorScreen';
import { ImportScreen } from './editor/ImportScreen';
import { CookedScreen } from './screens/CookedScreen';
import { RecipeScreen } from './screens/RecipeScreen';
import { SavedScreen } from './screens/SavedScreen';
import { PlainShell, TabShell, ToastHost } from './screens/Shell';
import { initTelegram } from './telegram/sdk';
import { parseStartParam, routeForTarget } from './telegram/startParam';
import { useBackButton } from './telegram/useBackButton';

// UX-03 design screens: development builds only (the import is dropped from production bundles).
const DesignScreens = import.meta.env.DEV ? lazy(() => import('./dev/design/DesignScreens')) : null;

type Boot =
  | { status: 'loading' }
  | { status: 'outside' }
  | { status: 'error'; error: unknown }
  | { status: 'ready'; me: Me };

/** Boots Telegram (real or dev mock), signs in via GET /me, applies the language, follows start_param. */
function useBoot(): { boot: Boot; retry: () => void } {
  const navigate = useNavigate();
  // `navigate` changes identity on every route change; the boot must NOT re-run because of that.
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  const startParamHandled = useRef(false);
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
        if (route && !startParamHandled.current) {
          startParamHandled.current = true;
          navigateRef.current(route, { replace: true });
        }
        setBoot({ status: 'ready', me });
      } catch (error) {
        if (!cancelled) setBoot({ status: 'error', error });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  return { boot, retry: () => setAttempt((n) => n + 1) };
}

function BookTab() {
  const book = useQuery(bookQuery);
  if (book.isLoading) return <Loading />;
  if (book.isError) return <ErrorState error={book.error} onRetry={() => void book.refetch()} />;
  if (!book.data) return <Onboarding />;
  return <BookScreen bookTitle={book.data.title} />;
}

function Ready({ me }: { me: Me }) {
  useBackButton();
  return (
    <>
      <Routes>
        <Route element={<TabShell />}>
          <Route path="/" element={<BookTab />} />
          <Route path="/saved" element={<SavedScreen />} />
          <Route path="/profile" element={<ProfileScreen me={me} />} />
        </Route>
        <Route element={<PlainShell />}>
          <Route path="/recipe/new" element={<EditorScreen />} />
          <Route path="/import" element={<ImportScreen />} />
          <Route path="/recipe/:id/edit" element={<EditorScreen />} />
          <Route path="/recipe/:id" element={<RecipeScreen me={me} />} />
          <Route path="/recipe/:id/cooked" element={<CookedScreen />} />
          <Route path="/cook/:id" element={<CookScreen me={me} />} />
          <Route path="/join/:code" element={<JoinScreen />} />
          <Route path="/r/:token" element={<LinkRecipeScreen />} />
          {DesignScreens && (
            <Route
              path="/dev/*"
              element={
                <Suspense fallback={<Loading />}>
                  <DesignScreens />
                </Suspense>
              }
            />
          )}
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
