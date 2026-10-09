import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { getRuntime } from './sdk';

const ROOT_PATHS = new Set(['/', '/saved', '/profile']);

/** Shows Telegram's native BackButton on every non-root screen and wires it to history. */
export function useBackButton(): void {
  const { pathname } = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    const { BackButton } = getRuntime().webApp;
    if (ROOT_PATHS.has(pathname)) {
      BackButton.hide();
      return;
    }
    const goBack = () =>
      window.history.length > 1 ? navigate(-1) : navigate('/', { replace: true });
    BackButton.show();
    BackButton.onClick(goBack);
    return () => BackButton.offClick(goBack);
  }, [pathname, navigate]);
}
