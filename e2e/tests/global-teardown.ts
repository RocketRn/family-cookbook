import { tidy } from './global-setup';
import { KEEPER, MEMBER } from './stack';

/** Leaves the demo book as it was: the recipes the tests wrote are deleted. */
export default async function globalTeardown() {
  for (const user of [KEEPER, MEMBER]) await tidy(user);
}
