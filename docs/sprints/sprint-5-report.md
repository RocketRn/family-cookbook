# Sprint 5 report: "After the first Telegram test"

Branch `claude/zen-brown-nifiv3`. This file is updated after every task, so the work can be picked up from the git log if a session stops.

## Progress

| #     | Task                                                               | State                                                              | Commit |
| ----- | ------------------------------------------------------------------ | ------------------------------------------------------------------ | ------ |
| S5-0  | Plan and this progress file                                        | done                                                               | (this) |
| S5-1  | Storage compatibility with Google Cloud Storage, and what to check | next                                                               |        |
| S5-2  | Production safety guard (fake tokens, stand-in addresses, arming)  | to do                                                              |        |
| S5-3  | BE-07 bot chat handling: /start, blocked bot, duplicate updates    | to do                                                              |        |
| S5-4  | BE-10 reactions and "I cooked it", the message to the author       | to do                                                              |        |
| S5-5  | FE-10 reactions and "I cooked it" on screen                        | to do                                                              |        |
| S5-6  | Notification settings, and the new-recipe message (off by default) | to do                                                              |        |
| S5-7  | FE-09 timers, full version                                         | to do                                                              |        |
| S5-8  | Saved recipes                                                      | to do                                                              |        |
| S5-9  | QA-01 automated browser tests in CI                                | to do                                                              |        |
| —     | Fixes from the first Telegram test                                 | placeholder: the owner sends the findings later as a separate task |        |
| S5-10 | Wrap-up: clean clone, CI, guides, report, Sprint 6 plan            | to do                                                              |        |

## The owner's answers (Sprint 5 approval)

1. "I cooked it" can be marked several times; the card shows "cooked N times".
2. A message to the author when someone cooks their recipe: on by default, with a quiet mode in the Profile. No message when you cook your own recipe.
3. A message to the whole book when a new recipe is published: off by default, with a switch in the Profile.
4. Automated browser tests in CI: yes (3–4 more minutes per run).
5. The first Telegram test has not been done: it is not waited for. Its fixes are a placeholder above.

Additions:

- Storage compatibility done pre-emptively, with what to check on Google Cloud Storage written down.
- A production safety guard after the Sprint 4 near miss, with a test that fails without it, and test setups that cannot start a production worker by accident.
- A commit and a push after every task, and this progress section kept current.

## Working rules (unchanged)

- Tests first, failing on the old code. Because every task is pushed and `pnpm verify` runs before every push, each task's tests and code go into one commit; the report records that the tests were run red before the code.
- One commit per task. CI green on Postgres 15 and 16. A clean-clone check with Docker Compose at the end.
- No real Telegram calls from the sandbox, no real tokens, no deployments.
