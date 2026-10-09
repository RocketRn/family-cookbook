import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { currentUser } from '../auth/plugin.js';
import type { Db } from '../db/pool.js';
import { withSystem, withUser } from '../db/tx.js';
import { AppError } from '../errors.js';
import {
  addMember,
  countMembers,
  createBook,
  detachRecipes,
  findBookByInviteCodeForUpdate,
  getBook,
  listMembers,
  lockUser,
  MAX_BOOK_MEMBERS,
  membershipOf,
  removeMember,
  rotateInviteCode,
  type Book,
} from './repo.js';

const createBody = z.object({ title: z.string().trim().min(1).max(100) });
const joinBody = z.object({ invite_code: z.string().trim().min(1).max(64) });
const memberParams = z.object({ user_id: z.string().uuid() });

const notInBook = () => new AppError(404, 'NOT_IN_BOOK', 'You are not in a book');

const bookView = (b: Book) => ({ id: b.id, title: b.title, created_at: b.created_at });

export function registerBooks(app: FastifyInstance, db: Db): void {
  // PRD 4.9 addition: create a book; idempotent; only for a user who is not yet in a book.
  app.post('/books', async (req, reply) => {
    const user = currentUser(req);
    const { title } = createBody.parse(req.body);
    const { book, created } = await withSystem(db, async (tx) => {
      await lockUser(tx, user.id);
      const existing = await membershipOf(tx, user.id);
      if (existing) {
        const book = await getBook(tx, existing.book_id);
        // Replay of the same request by the keeper returns the same book instead of failing.
        if (existing.role === 'owner' && book.title === title) return { book, created: false };
        throw new AppError(409, 'ALREADY_IN_BOOK', 'You already belong to a book');
      }
      return { book: await createBook(tx, user.id, title), created: true };
    });
    return reply
      .status(created ? 201 : 200)
      .send({ ...bookView(book), role: 'owner', invite_code: book.invite_code });
  });

  app.post('/books/join', async (req, reply) => {
    const user = currentUser(req);
    const { invite_code } = joinBody.parse(req.body);
    const { book, joined } = await withSystem(db, async (tx) => {
      await lockUser(tx, user.id);
      const book = await findBookByInviteCodeForUpdate(tx, invite_code);
      if (!book) throw new AppError(404, 'INVALID_INVITE_CODE', 'Invite code is not valid');
      const existing = await membershipOf(tx, user.id);
      if (existing) {
        if (existing.book_id === book.id) return { book, joined: false };
        throw new AppError(409, 'ALREADY_IN_BOOK', 'You already belong to a book');
      }
      if ((await countMembers(tx, book.id)) >= MAX_BOOK_MEMBERS) {
        throw new AppError(409, 'CONFLICT', `A book can have at most ${MAX_BOOK_MEMBERS} members`);
      }
      await addMember(tx, book.id, user.id);
      return { book, joined: true };
    });
    return reply
      .status(joined ? 201 : 200)
      .send({ ...bookView(book), role: joined ? 'member' : undefined });
  });

  app.get('/books/current', async (req) => {
    const user = currentUser(req);
    return withUser(db, { userId: user.id }, async (tx) => {
      const m = await membershipOf(tx, user.id);
      if (!m) throw notInBook();
      const book = await getBook(tx, m.book_id);
      const members = await listMembers(tx, m.book_id);
      return {
        ...bookView(book),
        role: m.role,
        // The invite code is a join credential: only the keeper sees it.
        ...(m.role === 'owner' ? { invite_code: book.invite_code } : {}),
        members,
      };
    });
  });

  app.delete('/books/current/members/:user_id', async (req, reply) => {
    const user = currentUser(req);
    const { user_id } = memberParams.parse(req.params);
    await withSystem(db, async (tx) => {
      await lockUser(tx, user.id);
      const me = await membershipOf(tx, user.id);
      if (!me) throw notInBook();
      if (me.role !== 'owner')
        throw new AppError(403, 'FORBIDDEN', 'Only the keeper can remove members');
      if (user_id === user.id) {
        throw new AppError(
          409,
          'KEEPER_CANNOT_LEAVE',
          'The keeper cannot be removed from the book',
        );
      }
      const target = await membershipOf(tx, user_id);
      if (!target || target.book_id !== me.book_id)
        throw new AppError(404, 'NOT_FOUND', 'Member not found');
      await detachRecipes(tx, me.book_id, user_id);
      await removeMember(tx, me.book_id, user_id);
    });
    return reply.status(204).send();
  });

  app.post('/books/current/invite/rotate', async (req) => {
    const user = currentUser(req);
    return withSystem(db, async (tx) => {
      const me = await membershipOf(tx, user.id);
      if (!me) throw notInBook();
      if (me.role !== 'owner')
        throw new AppError(403, 'FORBIDDEN', 'Only the keeper can re-issue the invite code');
      return { invite_code: await rotateInviteCode(tx, me.book_id) };
    });
  });

  app.post('/books/leave', async (req, reply) => {
    const user = currentUser(req);
    await withSystem(db, async (tx) => {
      await lockUser(tx, user.id);
      const me = await membershipOf(tx, user.id);
      if (!me) throw notInBook();
      if (me.role === 'owner') {
        throw new AppError(
          409,
          'KEEPER_CANNOT_LEAVE',
          'The keeper cannot leave until the role is transferred',
        );
      }
      await detachRecipes(tx, me.book_id, user.id);
      await removeMember(tx, me.book_id, user.id);
    });
    return reply.status(204).send();
  });
}
