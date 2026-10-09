import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../design/Button';
import { Chip } from '../../design/Chip';

const SCREENS = ['form', 'sent', 'author', 'own'] as const;
type Screen = (typeof SCREENS)[number];
const TITLE = 'Шарлотка';
const AUTHOR = 'Dev Keeper';
const COOK = 'Dev Member';
const SAMPLE_COMMENT = '«Получилось очень вкусно, добавила побольше корицы!»';

/**
 * UX-05 (PRD 2.4 steps 12-14, 3.2 reactions): the "I cooked it" screen for BE-10 / FE-10
 * (Sprint 5). Sample data, nothing is saved or sent. A photo and a few words are both optional;
 * the author gets one message with them, unless the cook is the author.
 */
export function CookedDesign() {
  const { t } = useTranslation();
  const [screen, setScreen] = useState<Screen>('form');
  return (
    <div className="stack">
      <div className="row row--wrap" role="group" aria-label={t('dev.cooked_link')}>
        {SCREENS.map((s) => (
          <Chip key={s} selected={screen === s} onToggle={() => setScreen(s)}>
            {t(`cooked.screen_${s}`)}
          </Chip>
        ))}
      </div>
      {screen === 'form' && <Form onSend={() => setScreen('sent')} />}
      {screen === 'sent' && <Sent />}
      {screen === 'author' && <AuthorMessage />}
      {screen === 'own' && <Own />}
    </div>
  );
}

function Form({ onSend }: { onSend: () => void }) {
  const { t } = useTranslation();
  const [comment, setComment] = useState('');
  const left = `${comment.length} / 500`;
  return (
    <div className="stack">
      <h1>{t('cooked.title', { title: TITLE })}</h1>
      <p className="hint">{t('cooked.intro', { name: AUTHOR })}</p>
      <button type="button" className="slot">
        <span aria-hidden="true">{'＋'}</span>
        <span>{t('cook.cooked_photo')}</span>
      </button>
      <label className="stack stack--tight">
        <span className="label">{t('cook.cooked_comment')}</span>
        <textarea
          className="field textarea"
          value={comment}
          maxLength={500}
          lang="ru"
          placeholder={t('cooked.comment_hint')}
          onChange={(e) => setComment(e.target.value)}
        />
      </label>
      <p className="hint">{left}</p>
      <div className="actionbar row">
        <Button variant="secondary" className="grow">
          {t('cooked.later')}
        </Button>
        <Button className="grow" onClick={onSend}>
          {t('cook.cooked_send')}
        </Button>
      </div>
    </div>
  );
}

function Sent() {
  const { t } = useTranslation();
  return (
    <div className="stack center">
      <p className="cook__done" aria-hidden="true">
        {'👨‍🍳'}
      </p>
      <h1>{t('cooked.sent_title')}</h1>
      <p>{t('cooked.sent_text', { name: AUTHOR })}</p>
      <p className="hint">{t('cooked.sent_reaction')}</p>
      <Button block>{t('cook.back_to_recipe')}</Button>
    </div>
  );
}

/** The bot's message to the author (BE-08 outbox, type recipe_cooked), as Telegram shows it. */
function AuthorMessage() {
  const { t } = useTranslation();
  return (
    <div className="stack">
      <p className="hint">{t('cooked.author_note')}</p>
      <div className="section stack stack--tight">
        <div className="slot" aria-hidden="true">
          {'📷'}
        </div>
        <p>
          <strong>{t('cooked.author_msg', { name: COOK, title: TITLE })}</strong>
        </p>
        <p lang="ru">{SAMPLE_COMMENT}</p>
        <Button variant="secondary">{t('cooked.author_open')}</Button>
      </div>
    </div>
  );
}

function Own() {
  const { t } = useTranslation();
  return (
    <div className="stack center">
      <p className="cook__done" aria-hidden="true">
        {'🎉'}
      </p>
      <h1>{t('cooked.sent_title')}</h1>
      <p>{t('cooked.own_text')}</p>
      <Button block>{t('cook.back_to_recipe')}</Button>
    </div>
  );
}
