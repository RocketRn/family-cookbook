import { randomBytes } from 'node:crypto';
import type { Tx } from '../db/tx.js';

export const MAX_BOOK_MEMBERS = 50;

export type BookRole = 'owner' | 'member';
export type Book = {
  id: string;
  title: string;
  owner_id: string;
  invite_code: string;
  created_at: Date;
};
export type Membership = { book_id: string; role: BookRole };

/** 9 random bytes -> 12 chars of [A-Za-z0-9_-], safe inside a `startapp=join_<code>` payload. */
export const newInviteCode = (): string => randomBytes(9).toString('base64url');

/**
 * Serialises one user's membership changes (double-tapped "Create", two joins at once). Without it
 * both requests pass the "not in a book yet" check and one dies on a unique constraint with a 500.
 */
export async function lockUser(tx: Tx, userId: string): Promise<void> {
  await tx.query('SELECT 1 FROM users WHERE id = $1 FOR UPDATE', [userId]);
}

export async function membershipOf(tx: Tx, userId: string): Promise<Membership | null> {
  const r = await tx.query<Membership>(
    'SELECT book_id, role FROM book_members WHERE user_id = $1',
    [userId],
  );
  return r.rows[0] ?? null;
}

export async function getBook(tx: Tx, bookId: string): Promise<Book> {
  const r = await tx.query<Book>('SELECT * FROM books WHERE id = $1', [bookId]);
  return r.rows[0]!;
}

/** Locks the book row so concurrent joins are counted one at a time (50-member cap). */
export async function findBookByInviteCodeForUpdate(tx: Tx, code: string): Promise<Book | null> {
  const r = await tx.query<Book>('SELECT * FROM books WHERE invite_code = $1 FOR UPDATE', [code]);
  return r.rows[0] ?? null;
}

export async function createBook(tx: Tx, ownerId: string, title: string): Promise<Book> {
  const book = (
    await tx.query<Book>(
      'INSERT INTO books (title, owner_id, invite_code) VALUES ($1, $2, $3) RETURNING *',
      [title, ownerId, newInviteCode()],
    )
  ).rows[0]!;
  await tx.query(`INSERT INTO book_members (book_id, user_id, role) VALUES ($1, $2, 'owner')`, [
    book.id,
    ownerId,
  ]);
  return book;
}

export async function countMembers(tx: Tx, bookId: string): Promise<number> {
  const r = await tx.query<{ n: string }>(
    'SELECT count(*)::text AS n FROM book_members WHERE book_id = $1',
    [bookId],
  );
  return Number(r.rows[0]!.n);
}

export async function addMember(tx: Tx, bookId: string, userId: string): Promise<void> {
  await tx.query(`INSERT INTO book_members (book_id, user_id, role) VALUES ($1, $2, 'member')`, [
    bookId,
    userId,
  ]);
}

/**
 * Takes a departing member's recipes out of the book (PRD 3.3): `book` visibility becomes
 * `private`; `link` recipes keep working through their share token but leave the book.
 */
export async function detachRecipes(tx: Tx, bookId: string, userId: string): Promise<void> {
  await tx.query(
    `UPDATE recipes
        SET visibility = CASE WHEN visibility = 'book' THEN 'private'::recipe_visibility ELSE visibility END,
            book_id = NULL,
            updated_at = now()
      WHERE book_id = $1 AND author_id = $2`,
    [bookId, userId],
  );
}

export async function removeMember(tx: Tx, bookId: string, userId: string): Promise<boolean> {
  const r = await tx.query('DELETE FROM book_members WHERE book_id = $1 AND user_id = $2', [
    bookId,
    userId,
  ]);
  return (r.rowCount ?? 0) > 0;
}

export async function rotateInviteCode(tx: Tx, bookId: string): Promise<string> {
  const r = await tx.query<{ invite_code: string }>(
    'UPDATE books SET invite_code = $2 WHERE id = $1 RETURNING invite_code',
    [bookId, newInviteCode()],
  );
  return r.rows[0]!.invite_code;
}

export type MemberView = {
  user_id: string;
  role: BookRole;
  joined_at: Date;
  first_name: string | null;
  tg_username: string | null;
  photo_url: string | null;
};

/** Read through RLS: only visible to members of the book. */
export async function listMembers(tx: Tx, bookId: string): Promise<MemberView[]> {
  const r = await tx.query<MemberView>(
    `SELECT m.user_id, m.role, m.joined_at, u.first_name, u.tg_username, u.photo_url
       FROM book_members m JOIN users u ON u.id = m.user_id
      WHERE m.book_id = $1
      ORDER BY m.role, m.joined_at`,
    [bookId],
  );
  return r.rows;
}
