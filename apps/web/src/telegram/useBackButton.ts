import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useLeaveGuard } from '../state/store';
import { confirmDialog, getRuntime } from './sdk';

const ROOT_PATHS = new Set(['/', '/saved', '/profile']);

/** Shows Telegram's native BackButton on every non-root screen and wires it to history. */
export function useBackButton(): void {
  const { pathname, key } = useLocation();
  const navigate = useNavigate();
  // React Router gives the first entry of this app session the key "default". window.history.length
  // is NOT usable: it also counts pages from before the Mini App opened, so "back" could leave the app.
  const hasInAppHistory = key !== 'default';

  useEffect(() => {
    const { BackButton } = getRuntime().webApp;
    if (ROOT_PATHS.has(pathname)) {
      BackButton.hide();
      return;
    }
    const leave = () => (hasInAppHistory ? navigate(-1) : navigate('/', { replace: true }));
    // A screen with unsaved changes (the editor) asks first.
    const goBack = () => {
      const unsaved = useLeaveGuard.getState().message;
      if (!unsaved) return leave();
      void confirmDialog(unsaved).then((ok) => {
        if (ok) {
          useLeaveGuard.getState().set(null);
          leave();
        }
      });
    };
    BackButton.show();
    BackButton.onClick(goBack);
    return () => BackButton.offClick(goBack);
  }, [pathname, navigate, hasInAppHistory]);
}
