import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { DEFAULT_PREFS, getMe, updateMe, type Me, type NotifyPrefs } from '../api/endpoints';
import { errorMessage } from '../errors';
import { useToastStore } from '../state/store';
import { haptic } from '../telegram/sdk';

const ME_KEY = ['me'] as const;

/**
 * Notification settings (PRD 3.2 notify_prefs; D-049). Each switch saves at once, only itself.
 * Quiet mode turns off the messages about other people ("cooked", "new recipe"); the bot's timer
 * messages always arrive. Owner's Sprint 5 answers: "cooked" on and "new recipe" off by default.
 */
export function NotifySettings({ me }: { me: Me }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const toast = useToastStore((s) => s.show);
  // The profile loaded at start-up seeds the cache; saving updates it, so the switches stay right.
  const profile = useQuery({
    queryKey: ME_KEY,
    queryFn: getMe,
    initialData: me,
    staleTime: Infinity,
  });
  const prefs: NotifyPrefs = { ...DEFAULT_PREFS, ...profile.data.notify_prefs };

  const save = useMutation({
    mutationFn: (patch: Partial<NotifyPrefs>) => updateMe({ notify_prefs: patch }),
    onMutate: (patch) => {
      const before = qc.getQueryData<Me>(ME_KEY);
      if (before)
        qc.setQueryData<Me>(ME_KEY, {
          ...before,
          notify_prefs: { ...before.notify_prefs, ...patch },
        });
      haptic('select');
      return { before };
    },
    onError: (err, _patch, ctx) => {
      if (ctx?.before) qc.setQueryData<Me>(ME_KEY, ctx.before);
      toast(errorMessage(t, err));
    },
    onSuccess: (saved) => qc.setQueryData<Me>(ME_KEY, saved),
  });

  const quiet = prefs.mute_social;
  // The label names the switch; the hint is its description (read after the name).
  const toggle = (key: keyof NotifyPrefs, label: string, hint: string, disabled = false) => (
    <label className="toggle">
      <input
        type="checkbox"
        checked={prefs[key]}
        disabled={disabled}
        aria-labelledby={`notify-${key}`}
        aria-describedby={`notify-${key}-hint`}
        onChange={(e) => save.mutate({ [key]: e.target.checked })}
      />
      <span className="stack stack--tight">
        <span id={`notify-${key}`}>{label}</span>
        <span id={`notify-${key}-hint`} className="hint">
          {hint}
        </span>
      </span>
    </label>
  );

  return (
    <section className="section stack stack--tight" aria-labelledby="notify-h">
      <h2 id="notify-h">{t('notify.title')}</h2>
      {toggle('mute_social', t('notify.mute_social'), t('notify.mute_social_hint'))}
      {toggle('cooked', t('notify.cooked'), t('notify.cooked_hint'), quiet)}
      {toggle('new_recipe', t('notify.new_recipe'), t('notify.new_recipe_hint'), quiet)}
      <p className="hint">{t('notify.timers_hint')}</p>
    </section>
  );
}
