DROP POLICY outbox_system_start ON notification_outbox;
REVOKE INSERT (type, recipient_user_id, payload, dedupe_key, priority) ON notification_outbox
  FROM cookbook_system;
DELETE FROM notification_outbox WHERE type = 'bot_start';
ALTER TABLE notification_outbox DROP CONSTRAINT notification_outbox_type_check;
ALTER TABLE notification_outbox ADD CONSTRAINT notification_outbox_type_check
  CHECK (type IN ('timer_fired', 'recipe_cooked', 'new_recipe'));

DROP TABLE tg_updates;
