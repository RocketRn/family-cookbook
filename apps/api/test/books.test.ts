import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../src/db/pool.js';
import { adminPool, authHeader, resetData, testApp, testPool } from './helpers/db.js';

let db: Db;
let admin: Db;
let app: FastifyInstance;
beforeAll(async () => {
  db = testPool();
  admin = adminPool();
  app = await testApp(db);
});
afterAll(async () => {
  await app.close();
  await db.end();
  await admin.end();
});
beforeEach(() => resetData(admin));

const KEEPER = 7001;
const MEMBER = 7002;
const OUTSIDER = 7003;

const call = (method: 'GET' | 'POST' | 'DELETE', url: string, tg: number, payload?: object) =>
  app.inject({ method, url, headers: authHeader(tg), ...(payload ? { payload } : {}) });

async function setup() {
  const created = (await call('POST', '/books', KEEPER, { title: 'Семья' })).json();
  const joined = await call('POST', '/books/join', MEMBER, { invite_code: created.invite_code });
  expect(joined.statusCode).toBe(201);
  const userId = async (tg: number) =>
    (await admin.query<{ id: string }>('SELECT id FROM users WHERE tg_user_id = $1', [tg])).rows[0]!
      .id;
  return { book: created, keeperId: await userId(KEEPER), memberId: await userId(MEMBER) };
}

describe('POST /books', () => {
  it('creates a book and makes the creator the owner', async () => {
    const res = await call('POST', '/books', KEEPER, { title: 'Семья' });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      title: 'Семья',
      role: 'owner',
      invite_code: expect.stringMatching(/^[A-Za-z0-9_-]{12}$/),
    });
    const m = await admin.query(`SELECT role FROM book_members`);
    expect(m.rows).toEqual([{ role: 'owner' }]);
  });

  it('is idempotent for a replay by the keeper', async () => {
    const a = await call('POST', '/books', KEEPER, { title: 'Семья' });
    const b = await call('POST', '/books', KEEPER, { title: 'Семья' });
    expect(b.statusCode).toBe(200);
    expect(b.json().id).toBe(a.json().id);
    expect((await admin.query('SELECT count(*) FROM books')).rows[0].count).toBe('1');
  });

  it('409 ALREADY_IN_BOOK for a user who is already in a book (different title or member)', async () => {
    const { book } = await setup();
    expect((await call('POST', '/books', KEEPER, { title: 'Other' })).json().error.code).toBe(
      'ALREADY_IN_BOOK',
    );
    expect((await call('POST', '/books', MEMBER, { title: book.title })).statusCode).toBe(409);
  });

  it('400 on an empty or missing title', async () => {
    const res = await call('POST', '/books', KEEPER, { title: '   ' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
    expect((await call('POST', '/books', KEEPER, {})).statusCode).toBe(400);
  });
});

describe('POST /books/join', () => {
  it('joins by invite code as member; repeat join is idempotent', async () => {
    const { book } = await setup();
    const again = await call('POST', '/books/join', MEMBER, { invite_code: book.invite_code });
    expect(again.statusCode).toBe(200);
    expect((await admin.query('SELECT count(*) FROM book_members')).rows[0].count).toBe('2');
  });

  it('404 INVALID_INVITE_CODE for an unknown code', async () => {
    const res = await call('POST', '/books/join', OUTSIDER, { invite_code: 'nope' });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('INVALID_INVITE_CODE');
  });

  it('409 when already in another book', async () => {
    const { book } = await setup();
    await call('POST', '/books', OUTSIDER, { title: 'Друзья' });
    const res = await call('POST', '/books/join', OUTSIDER, { invite_code: book.invite_code });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('ALREADY_IN_BOOK');
  });

  it('409 when the book already has 50 members', async () => {
    const { book, keeperId } = await setup();
    for (let i = 0; i < 48; i++) {
      const id = (
        await admin.query<{ id: string }>(
          `INSERT INTO users (tg_user_id) VALUES ($1) RETURNING id`,
          [9000 + i],
        )
      ).rows[0]!.id;
      await admin.query(`INSERT INTO book_members (book_id, user_id) VALUES ($1, $2)`, [
        book.id,
        id,
      ]);
    }
    expect(keeperId).toBeTruthy();
    const res = await call('POST', '/books/join', OUTSIDER, { invite_code: book.invite_code });
    expect(res.statusCode).toBe(409);
  });
});

describe('GET /books/current', () => {
  it('404 NOT_IN_BOOK when the user has no book', async () => {
    const res = await call('GET', '/books/current', OUTSIDER);
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('NOT_IN_BOOK');
  });

  it('returns the book and members; only the keeper sees the invite code', async () => {
    await setup();
    const k = (await call('GET', '/books/current', KEEPER)).json();
    expect(k.role).toBe('owner');
    expect(k.invite_code).toBeTruthy();
    expect(k.members).toHaveLength(2);
    const m = (await call('GET', '/books/current', MEMBER)).json();
    expect(m.role).toBe('member');
    expect(m.invite_code).toBeUndefined();
    expect(m.members).toHaveLength(2);
  });
});

describe('invite re-issue', () => {
  it('keeper rotates the code; the old code stops working immediately', async () => {
    const { book } = await setup();
    const res = await call('POST', '/books/current/invite/rotate', KEEPER);
    expect(res.statusCode).toBe(200);
    const fresh = res.json().invite_code;
    expect(fresh).not.toBe(book.invite_code);
    expect(
      (await call('POST', '/books/join', OUTSIDER, { invite_code: book.invite_code })).statusCode,
    ).toBe(404);
    expect((await call('POST', '/books/join', OUTSIDER, { invite_code: fresh })).statusCode).toBe(
      201,
    );
  });

  it('403 for a member; 404 NOT_IN_BOOK for an outsider', async () => {
    await setup();
    expect((await call('POST', '/books/current/invite/rotate', MEMBER)).statusCode).toBe(403);
    expect((await call('POST', '/books/current/invite/rotate', OUTSIDER)).json().error.code).toBe(
      'NOT_IN_BOOK',
    );
  });
});

describe('leaving and removing', () => {
  async function seedRecipes(bookId: string, authorId: string) {
    const ins = (title: string, visibility: string, token: string | null) =>
      admin.query(
        `INSERT INTO recipes (author_id, book_id, title, status, visibility, share_token) VALUES ($1, $2, $3, 'published', $4, $5)`,
        [authorId, bookId, title, visibility, token],
      );
    await ins('in book', 'book', null);
    await ins('by link', 'link', 'tok-leave-1');
    await ins('mine', 'private', null);
  }

  it('member leaves: book recipes become private, link recipes keep their token, all leave the book', async () => {
    const { book, memberId } = await setup();
    await seedRecipes(book.id, memberId);
    const res = await call('POST', '/books/leave', MEMBER);
    expect(res.statusCode).toBe(204);
    const r = await admin.query(
      `SELECT title, visibility, book_id, share_token FROM recipes ORDER BY title`,
    );
    expect(r.rows).toEqual([
      { title: 'by link', visibility: 'link', book_id: null, share_token: 'tok-leave-1' },
      { title: 'in book', visibility: 'private', book_id: null, share_token: null },
      { title: 'mine', visibility: 'private', book_id: null, share_token: null },
    ]);
    expect((await call('GET', '/books/current', MEMBER)).statusCode).toBe(404);
  });

  it('keeper cannot leave: 409 KEEPER_CANNOT_LEAVE', async () => {
    await setup();
    const res = await call('POST', '/books/leave', KEEPER);
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('KEEPER_CANNOT_LEAVE');
    expect((await admin.query('SELECT count(*) FROM book_members')).rows[0].count).toBe('2');
  });

  it('leave without a book: 404 NOT_IN_BOOK', async () => {
    expect((await call('POST', '/books/leave', OUTSIDER)).json().error.code).toBe('NOT_IN_BOOK');
  });

  it('keeper removes a member; their book recipes become private', async () => {
    const { book, memberId } = await setup();
    await seedRecipes(book.id, memberId);
    const res = await call('DELETE', `/books/current/members/${memberId}`, KEEPER);
    expect(res.statusCode).toBe(204);
    expect(
      (await admin.query(`SELECT count(*) FROM recipes WHERE visibility = 'book'`)).rows[0].count,
    ).toBe('0');
    expect((await admin.query('SELECT count(*) FROM book_members')).rows[0].count).toBe('1');
  });

  it('a member cannot remove anyone (403); the keeper cannot remove themselves (409)', async () => {
    const { keeperId, memberId } = await setup();
    expect((await call('DELETE', `/books/current/members/${keeperId}`, MEMBER)).statusCode).toBe(
      403,
    );
    expect((await call('DELETE', `/books/current/members/${memberId}`, MEMBER)).statusCode).toBe(
      403,
    );
    const self = await call('DELETE', `/books/current/members/${keeperId}`, KEEPER);
    expect(self.statusCode).toBe(409);
    expect(self.json().error.code).toBe('KEEPER_CANNOT_LEAVE');
  });

  it("removing someone who is not in the keeper's book: 404; bad id: 400", async () => {
    await setup();
    await call('POST', '/books', OUTSIDER, { title: 'Другая' });
    const other = (
      await admin.query<{ id: string }>('SELECT id FROM users WHERE tg_user_id = $1', [OUTSIDER])
    ).rows[0]!.id;
    expect((await call('DELETE', `/books/current/members/${other}`, KEEPER)).statusCode).toBe(404);
    expect((await call('DELETE', '/books/current/members/not-a-uuid', KEEPER)).statusCode).toBe(
      400,
    );
  });
});

describe('concurrency (double taps, simultaneous joins)', () => {
  it('five simultaneous POST /books from one user create exactly one book and no 500', async () => {
    const res = await Promise.all(
      Array.from({ length: 5 }, () => call('POST', '/books', KEEPER, { title: 'Семья' })),
    );
    const codes = res.map((r) => r.statusCode).sort();
    expect(codes).toEqual([200, 200, 200, 200, 201]);
    expect(new Set(res.map((r) => r.json().id)).size).toBe(1);
    expect((await admin.query('SELECT count(*) FROM books')).rows[0].count).toBe('1');
  });

  it('simultaneous joins by one user end with one membership and no 500', async () => {
    const created = (await call('POST', '/books', KEEPER, { title: 'Семья' })).json();
    const res = await Promise.all(
      Array.from({ length: 5 }, () =>
        call('POST', '/books/join', MEMBER, { invite_code: created.invite_code }),
      ),
    );
    expect(res.map((r) => r.statusCode).sort()).toEqual([200, 200, 200, 200, 201]);
    expect((await admin.query('SELECT count(*) FROM book_members')).rows[0].count).toBe('2');
  });

  it('the 50-member cap holds when two people join the last free seat at the same time', async () => {
    const created = (await call('POST', '/books', KEEPER, { title: 'Семья' })).json();
    for (let i = 0; i < 48; i++) {
      const id = (
        await admin.query<{ id: string }>(
          `INSERT INTO users (tg_user_id) VALUES ($1) RETURNING id`,
          [9100 + i],
        )
      ).rows[0]!.id;
      await admin.query(`INSERT INTO book_members (book_id, user_id) VALUES ($1, $2)`, [
        created.id,
        id,
      ]);
    }
    // 49 members now: one seat left, two candidates at once.
    const res = await Promise.all([
      call('POST', '/books/join', MEMBER, { invite_code: created.invite_code }),
      call('POST', '/books/join', OUTSIDER, { invite_code: created.invite_code }),
    ]);
    expect(res.map((r) => r.statusCode).sort()).toEqual([201, 409]);
    expect((await admin.query('SELECT count(*) FROM book_members')).rows[0].count).toBe('50');
  });
});
