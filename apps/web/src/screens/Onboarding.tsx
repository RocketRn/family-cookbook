import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { createBook, joinBook } from '../api/endpoints';
import { Button } from '../design/Button';
import { TextField } from '../design/Fields';
import { errorMessage } from '../errors';
import { haptic } from '../telegram/sdk';

/** Shown when the signed-in user is not in a book yet: create one (POST /books) or join by code. */
export function Onboarding({ initialCode = '' }: { initialCode?: string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [title, setTitle] = useState('');
  const [code, setCode] = useState(initialCode);

  const done = () => {
    haptic('success');
    void qc.invalidateQueries({ queryKey: ['book'] });
  };
  const create = useMutation({ mutationFn: () => createBook(title.trim()), onSuccess: done });
  const join = useMutation({ mutationFn: () => joinBook(code.trim()), onSuccess: done });

  const onCreate = (e: FormEvent) => {
    e.preventDefault();
    if (title.trim()) create.mutate();
  };
  const onJoin = (e: FormEvent) => {
    e.preventDefault();
    if (code.trim()) join.mutate();
  };

  return (
    <div className="stack">
      <div>
        <h1>{t('onboarding.title')}</h1>
        <p className="hint">{t('onboarding.text')}</p>
      </div>
      <form className="section stack" onSubmit={onCreate}>
        <h2>{t('onboarding.create_title')}</h2>
        <TextField
          label={t('onboarding.book_title_label')}
          placeholder={t('onboarding.book_title_placeholder')}
          value={title}
          maxLength={100}
          onChange={(e) => setTitle(e.target.value)}
        />
        {create.isError && (
          <p className="error-text" role="alert">
            {errorMessage(t, create.error)}
          </p>
        )}
        <Button type="submit" block disabled={create.isPending || !title.trim()}>
          {t('onboarding.create_button')}
        </Button>
      </form>
      <p className="hint center" style={{ padding: 0 }}>
        {t('common.or')}
      </p>
      <form className="section stack" onSubmit={onJoin}>
        <h2>{t('onboarding.join_title')}</h2>
        <TextField
          label={t('onboarding.join_code_label')}
          value={code}
          autoCapitalize="off"
          autoCorrect="off"
          maxLength={64}
          onChange={(e) => setCode(e.target.value)}
        />
        {join.isError && (
          <p className="error-text" role="alert">
            {errorMessage(t, join.error)}
          </p>
        )}
        <Button type="submit" variant="secondary" block disabled={join.isPending || !code.trim()}>
          {t('onboarding.join_button')}
        </Button>
      </form>
    </div>
  );
}
