# How to migrate?

# Guide
ALWAYS use these 4 steps: 

- Schema changes: make some schema changes
- db generate: `bun run db:generate`
- db migrate: `bun run db:migrate`
- db push: `bun run db:push`

Important:
- Never edit old migration SQL files after they are applied. Create a new migration instead.
- If migrations drift or conflict locally, do not reset DB by default. Only reset DB with explicit user approval.

