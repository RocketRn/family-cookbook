DROP TRIGGER recipes_new_recipe ON recipes;
DROP FUNCTION queue_new_recipe();
DELETE FROM notification_outbox WHERE type = 'new_recipe';
DROP FUNCTION update_notify_prefs(jsonb);
ALTER TABLE users ALTER COLUMN notify_prefs
  SET DEFAULT '{"timers": true, "cooked": true, "new_recipe": true, "mute_social": false}'::jsonb;
