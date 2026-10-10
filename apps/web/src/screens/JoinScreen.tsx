import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { joinBook } from '../api/endpoints';
import { Button } from '../design/Button';
import { errorMessage } from '../errors';
import { haptic } from '../telegram/sdk';
import { useToastStore } from '../state/store';

/** Landing for `startapp=join_<code>` deep links. */
export function JoinScreen() {
  const { t } = useTranslation();
  const { code = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToastStore((s) => s.show);
  const join = useMutation({
    mutationFn: () => joinBook(code),
    onSuccess: async () => {
      haptic('success');
      await qc.invalidateQueries({ queryKey: ['book'] });
      toast(t('join.success'));
      navigate('/', { replace: true });
    },
    onError: () => haptic('error'),
  });

  return (
    <div className="stack">
      <h1>{t('join.title')}</h1>
      <p className="hint">{t('join.text')}</p>
      {join.isError && (
        <p className="error-text" role="alert">
          {errorMessage(t, join.error)}
        </p>
      )}
      <Button block disabled={join.isPending} onClick={() => join.mutate()}>
        {t('join.button')}
      </Button>
    </div>
  );
}
