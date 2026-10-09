-- BE-02: users (PRD 3.2). RLS is not enabled on users: it holds only the public Telegram profile.
CREATE TYPE ui_lang AS ENUM ('ru', 'uk', 'en', 'sv');

CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tg_user_id    bigint NOT NULL UNIQUE,
  tg_username   text,
  first_name    text,
  photo_url     text,
  ui_lang       ui_lang NOT NULL DEFAULT 'en',
  bot_started   boolean NOT NULL DEFAULT false,
  notify_prefs  jsonb NOT NULL DEFAULT '{"timers": true, "cooked": true, "new_recipe": true, "mute_social": false}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz
);
