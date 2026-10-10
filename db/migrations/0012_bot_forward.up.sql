-- S6-2 (Sprint 6): a recipe forwarded to the bot becomes a private draft (PRD 2.2 variant B, UC-02;
-- owner's Sprint 6 additions; D-054).
--
-- Forwarded text is untrusted, so the bot acts only for people who already opened the app: the
-- app's sign-in (initData signed by Telegram) stamps app_opened_at once. /start alone does not.
--
-- Who may do what:
--   cookbook_system  stamps app_opened_at at sign-in; records the update and queues the bot's
--                    answers (types bot_start and bot_reply). It never writes the draft.
--   cookbook_app     writes the draft as the sender, under the recipes' row-level security.
--   cookbook_worker  sends the answers like any other message.

ALTER TABLE users ADD COLUMN app_opened_at timestamptz;
GRANT INSERT (app_opened_at), UPDATE (app_opened_at) ON users TO cookbook_system;

ALTER TABLE notification_outbox DROP CONSTRAINT notification_outbox_type_check;
ALTER TABLE notification_outbox ADD CONSTRAINT notification_outbox_type_check
  CHECK (type IN ('timer_fired', 'recipe_cooked', 'new_recipe', 'bot_start', 'bot_reply'));

DROP POLICY outbox_system_start ON notification_outbox;
CREATE POLICY outbox_system_bot ON notification_outbox FOR INSERT TO cookbook_system
  WITH CHECK (type IN ('bot_start', 'bot_reply'));

-- The per-person limit counts forwarded recipes of the last hour (deleted ones too).
CREATE INDEX recipes_bot_forward_idx ON recipes (author_id, created_at)
  WHERE source_type = 'bot_forward';
