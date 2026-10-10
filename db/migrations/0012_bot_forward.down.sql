DROP INDEX recipes_bot_forward_idx;

DROP POLICY outbox_system_bot ON notification_outbox;
CREATE POLICY outbox_system_start ON notification_outbox FOR INSERT TO cookbook_system
  WITH CHECK (type = 'bot_start');

DELETE FROM notification_outbox WHERE type = 'bot_reply';
ALTER TABLE notification_outbox DROP CONSTRAINT notification_outbox_type_check;
ALTER TABLE notification_outbox ADD CONSTRAINT notification_outbox_type_check
  CHECK (type IN ('timer_fired', 'recipe_cooked', 'new_recipe', 'bot_start'));

REVOKE INSERT (app_opened_at), UPDATE (app_opened_at) ON users FROM cookbook_system;
ALTER TABLE users DROP COLUMN app_opened_at;
