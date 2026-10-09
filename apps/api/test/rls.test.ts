import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../src/db/pool.js';
import { withUser, withSystem } from '../src/db/tx.js';
import { insertUser, resetData, testPool } from './helpers/db.js';

/**
 * PRD 3.3 access matrix, enforced by Row Level Security. Every read here goes through
 * withUser(), i.e. the restricted `cookbook_app` role with the per-transaction identity.
 */
let db: Db;
const ids = {} as Record<'author' | 'member' | 'keeper' | 'outsider', string>;
let bookId: string;
let otherBookId: string;
const TOKEN = 'share-token-for-link-recipe';

beforeAll(() => {
  db = testPool();
});
afterAll(() => db.end());

async function insertRecipe(o: {
  title: string;
  status: 'draft' | 'published' | 'archived';
  visibility: 'private' | 'book' | 'link';
  inBook?: boolean;
  token?: string | null;
  deleted?: boolean;
  author?: string;
}) {
  await db.query(
    `INSERT INTO recipes (author_id, book_id, title, status, visibility, share_token, deleted_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      o.author ?? ids.author,
      o.inBook === false ? null : bookId,
      o.title,
      o.status,
      o.visibility,
      o.token ?? null,
      o.deleted ? new Date() : null,
    ],
  );
}

beforeEach(async () => {
  await resetData(db);
  ids.author = await insertUser(db, 1);
  ids.member = await insertUser(db, 2);
  ids.keeper = await insertUser(db, 3);
  ids.outsider = await insertUser(db, 4);
  const mk = async (title: string, code: string, owner: string) =>
    (
      await db.query<{ id: string }>(
        `INSERT INTO books (title, owner_id, invite_code) VALUES ($1, $2, $3) RETURNING id`,
        [title, owner, code],
      )
    ).rows[0]!.id;
  bookId = await mk('family', 'code-a', ids.keeper);
  otherBookId = await mk('other', 'code-b', ids.outsider);
  await db.query(
    `INSERT INTO book_members (book_id, user_id, role) VALUES ($1,$2,'owner'),($1,$3,'member'),($1,$4,'member'),($5,$6,'owner')`,
    [bookId, ids.keeper, ids.author, ids.member, otherBookId, ids.outsider],
  );

  await insertRecipe({ title: 'private-published', status: 'published', visibility: 'private' });
  await insertRecipe({ title: 'draft-book', status: 'draft', visibility: 'book' });
  await insertRecipe({
    title: 'draft-link',
    status: 'draft',
    visibility: 'link',
    token: TOKEN + '-draft',
  });
  await insertRecipe({ title: 'book', status: 'published', visibility: 'book' });
  await insertRecipe({ title: 'link', status: 'published', visibility: 'link', token: TOKEN });
  await insertRecipe({
    title: 'link-no-book',
    status: 'published',
    visibility: 'link',
    inBook: false,
    token: TOKEN + '-nb',
  });
  await insertRecipe({ title: 'archived-book', status: 'archived', visibility: 'book' });
  await insertRecipe({
    title: 'deleted-book',
    status: 'published',
    visibility: 'book',
    deleted: true,
  });
});

const titlesFor = (userId: string, shareToken?: string) =>
  withUser(db, { userId, shareToken }, async (tx) =>
    (await tx.query<{ title: string }>('SELECT title FROM recipes ORDER BY title')).rows.map(
      (r) => r.title,
    ),
  );

describe('read matrix (PRD 3.3)', () => {
  it('author sees all of their own live recipes, including drafts and private', async () => {
    expect(await titlesFor(ids.author)).toEqual([
      'archived-book',
      'book',
      'draft-book',
      'draft-link',
      'link',
      'link-no-book',
      'private-published',
    ]);
  });

  it('book member sees only published book/link recipes of the book: no private, no drafts', async () => {
    expect(await titlesFor(ids.member)).toEqual(['book', 'link']);
  });

  it("keeper has no extra read access to someone else's private recipe or draft", async () => {
    expect(await titlesFor(ids.keeper)).toEqual(['book', 'link']);
  });

  it('a user in a different book sees nothing of this book', async () => {
    expect(await titlesFor(ids.outsider)).toEqual([]);
  });

  it('outsider with a valid share_token sees only that published link recipe', async () => {
    expect(await titlesFor(ids.outsider, TOKEN)).toEqual(['link']);
    expect(await titlesFor(ids.outsider, TOKEN + '-nb')).toEqual(['link-no-book']);
  });

  it('a share_token does not unlock a draft, private, book-visibility or deleted recipe', async () => {
    expect(await titlesFor(ids.outsider, TOKEN + '-draft')).toEqual([]);
    expect(await titlesFor(ids.outsider, 'book')).toEqual([]);
    expect(await titlesFor(ids.outsider, 'wrong-token')).toEqual([]);
  });

  it('no identity and no token sees nothing; a token alone unlocks only the published link recipe', async () => {
    const rows = (shareToken?: string) =>
      withUser(db, { userId: '', shareToken }, async (tx) =>
        (await tx.query<{ title: string }>('SELECT title FROM recipes')).rows.map((r) => r.title),
      );
    expect(await rows()).toEqual([]);
    expect(await rows(TOKEN)).toEqual(['link']);
  });

  it('a soft-deleted recipe is invisible to everyone, including its author', async () => {
    expect(await titlesFor(ids.author)).not.toContain('deleted-book');
    expect(await titlesFor(ids.member)).not.toContain('deleted-book');
  });

  it("after the author leaves the book, former members lose access to that author's recipes", async () => {
    await withSystem(db, async (tx) => {
      await tx.query(
        `UPDATE recipes SET visibility = CASE WHEN visibility = 'book' THEN 'private'::recipe_visibility ELSE visibility END, book_id = NULL WHERE author_id = $1`,
        [ids.author],
      );
      await tx.query('DELETE FROM book_members WHERE user_id = $1', [ids.author]);
    });
    expect(await titlesFor(ids.member)).toEqual([]);
    expect(await titlesFor(ids.outsider, TOKEN)).toEqual(['link']); // token access survives
  });
});

describe('books and book_members visibility', () => {
  it('members see their own book and its member list; others see nothing', async () => {
    const q = (userId: string) =>
      withUser(db, { userId }, async (tx) => ({
        books: (await tx.query('SELECT id FROM books')).rowCount,
        members: (await tx.query('SELECT user_id FROM book_members')).rowCount,
      }));
    expect(await q(ids.member)).toEqual({ books: 1, members: 3 });
    expect(await q(ids.outsider)).toEqual({ books: 1, members: 1 }); // only their own book
    const nobody = await db.query<{ id: string }>(
      `INSERT INTO users (tg_user_id) VALUES (99) RETURNING id`,
    );
    expect(await q(nobody.rows[0]!.id)).toEqual({ books: 0, members: 0 });
  });

  it('the restricted role cannot write books or memberships at all', async () => {
    await expect(
      withUser(db, { userId: ids.member }, (tx) =>
        tx.query(`INSERT INTO book_members (book_id, user_id) VALUES ($1, $2)`, [
          otherBookId,
          ids.member,
        ]),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      withUser(db, { userId: ids.member }, (tx) => tx.query(`UPDATE books SET title = 'x'`)),
    ).rejects.toThrow(/permission denied/);
  });
});

describe('write rules', () => {
  const insert = (userId: string, authorId: string, book: string | null) =>
    withUser(db, { userId }, (tx) =>
      tx.query(`INSERT INTO recipes (author_id, book_id, title) VALUES ($1, $2, 'new')`, [
        authorId,
        book,
      ]),
    );

  it('a member can create their own recipe in their book or in no book', async () => {
    await expect(insert(ids.member, ids.member, bookId)).resolves.toBeDefined();
    await expect(insert(ids.member, ids.member, null)).resolves.toBeDefined();
  });

  it('cannot create a recipe in a book they do not belong to, or as someone else', async () => {
    await expect(insert(ids.member, ids.member, otherBookId)).rejects.toThrow(/row-level security/);
    await expect(insert(ids.member, ids.author, bookId)).rejects.toThrow(/row-level security/);
  });

  it('only the author can update or delete; others silently affect zero rows', async () => {
    const upd = (userId: string) =>
      withUser(db, { userId }, (tx) =>
        tx.query(`UPDATE recipes SET title = 'hacked' WHERE title = 'book'`),
      );
    expect((await upd(ids.member)).rowCount).toBe(0);
    expect((await upd(ids.keeper)).rowCount).toBe(0); // the keeper cannot edit someone else's text
    expect((await upd(ids.author)).rowCount).toBe(1);

    const del = (userId: string) =>
      withUser(db, { userId }, (tx) => tx.query(`DELETE FROM recipes WHERE title = 'link'`));
    expect((await del(ids.member)).rowCount).toBe(0);
    expect((await del(ids.author)).rowCount).toBe(1);
  });

  it('an author cannot move their recipe into a book they are not in', async () => {
    await expect(
      withUser(db, { userId: ids.author }, (tx) =>
        tx.query(`UPDATE recipes SET book_id = $1 WHERE title = 'book'`, [otherBookId]),
      ),
    ).rejects.toThrow(/row-level security/);
  });
});

describe('identity does not leak across pooled connections', () => {
  it('app.user_id is transaction-scoped: empty after the transaction', async () => {
    await withUser(db, { userId: ids.member, shareToken: TOKEN }, async (tx) => {
      expect((await tx.query(`SELECT current_setting('app.user_id') AS v`)).rows[0].v).toBe(
        ids.member,
      );
    });
    // A single-connection pool guarantees we reuse the same session.
    const { createPool } = await import('../src/db/pool.js');
    const one = createPool(process.env.DATABASE_URL!);
    one.options.max = 1;
    try {
      await withUser(one, { userId: ids.member, shareToken: TOKEN }, async () => undefined);
      const r = await one.query(
        `SELECT current_setting('app.user_id', true) AS u, current_setting('app.share_token', true) AS t, current_user AS role`,
      );
      expect(r.rows[0].u).toBe('');
      expect(r.rows[0].t).toBe('');
      expect(r.rows[0].role).not.toBe('cookbook_app'); // SET LOCAL ROLE also reverted
    } finally {
      await one.end();
    }
  });
});
