-- Local development seed. Idempotent. The two users match the web mock provider
-- (apps/web/src/telegram/mockUser.ts): Telegram ids 100000001 (keeper) and 100000002 (member).
INSERT INTO users (id, tg_user_id, tg_username, first_name, ui_lang) VALUES
  ('00000000-0000-4000-8000-000000000001', 100000001, 'dev_keeper', 'Dev Keeper', 'ru'),
  ('00000000-0000-4000-8000-000000000002', 100000002, 'dev_member', 'Dev Member', 'en')
ON CONFLICT (tg_user_id) DO NOTHING;

INSERT INTO books (id, title, owner_id, invite_code) VALUES
  ('00000000-0000-4000-8000-0000000000b1', 'Семья', '00000000-0000-4000-8000-000000000001', 'devinvitecode')
ON CONFLICT (id) DO NOTHING;

INSERT INTO book_members (book_id, user_id, role) VALUES
  ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-000000000001', 'owner'),
  ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-000000000002', 'member')
ON CONFLICT DO NOTHING;

INSERT INTO recipes (id, author_id, book_id, title, status, visibility, share_token) VALUES
  ('00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-000000000001',
   '00000000-0000-4000-8000-0000000000b1', 'Голубцы', 'published', 'book', NULL),
  ('00000000-0000-4000-8000-0000000000c2', '00000000-0000-4000-8000-000000000002',
   '00000000-0000-4000-8000-0000000000b1', 'Syrniki', 'published', 'link', 'dev-share-token-syrniki'),
  ('00000000-0000-4000-8000-0000000000c3', '00000000-0000-4000-8000-000000000001',
   NULL, 'Личная заметка', 'draft', 'private', NULL)
ON CONFLICT (id) DO NOTHING;
