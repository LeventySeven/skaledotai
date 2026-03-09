# Server Code Patterns

## File Locations
- Routers: `src/server/trpc/routers/`
- Services: `src/server/services/`
- Validations: `src/lib/validations/`
- Constants: `src/lib/constants.ts`
- tRPC init: `src/server/trpc/trpc.ts`
- Context: `src/server/trpc/context.ts`
- Root router: `src/server/trpc/root.ts`
- Server caller: `src/lib/trpc/server.ts` (`serverTrpc()`)

---

## Router Pattern

```ts
import 'server-only'
import { protectedProcedure, router } from "../trpc";
import { CreateThingInputSchema } from "@/lib/validations/things";
import { createThing, getThings, deleteThing } from "@/server/services/things";

export const thingsRouter = router({
  list: protectedProcedure
    .query(({ ctx }) => getThings(ctx.userId)),

  create: protectedProcedure
    .input(CreateThingInputSchema)
    .mutation(({ ctx, input }) => createThing(ctx.userId, input)),

  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ ctx, input }) => deleteThing(ctx.userId, input.id)),
});
```

**Rules:**
- `import 'server-only'` at the top, always
- Router body is one line per procedure — delegate straight to a service
- No DB logic in routers. If you're querying in a router, move it to a service
- `ctx.userId` is the only trust boundary — never accept `userId` as input
- Use `assertThing(ctx.userId, input.thingId)` before service calls when checking resource ownership
- Wire new routers into `src/server/trpc/root.ts`

---

## Procedure Rules (from tRPC docs)

**`.input()` — always declare it when the procedure takes arguments**
```ts
.input(CreateThingInputSchema)   // ✅ validated + typed
.input(z.object({ id: z.string().uuid() }))  // ✅ inline for simple shapes
```

**`.output()` — optional, use only when:**
- Returning data from an untrusted/external source (external API, raw DB row with sensitive fields)
- You need to explicitly strip fields before sending to client

> tRPC docs: *"Validating outputs is not always as important as defining inputs, since tRPC gives you automatic type-safety by inferring the return type."*

Don't add `.output()` everywhere — it adds runtime Zod overhead for no benefit when you control the data.

**Mutations return the entity, not `{ success: boolean }`**
```ts
// ✅ return the created/updated entity — client gets it in onSuccess(data)
.mutation(({ ctx, input }) => createThing(ctx.userId, input))

// ❌ wastes the return value — mutation.isSuccess already tells you it worked
.mutation(async ({ ctx, input }) => {
  await createThing(ctx.userId, input);
  return { success: true };
})
```

---

## Service Pattern

```ts
import 'server-only'
import { TRPCError } from '@trpc/server';
import { db } from '@/db';
import { things } from '@/db/schema';
import { THING_LIMIT } from '@/lib/constants';

export async function getThings(userId: string) {
  return db.select().from(things).where(eq(things.userId, userId));
}

export async function assertThing(userId: string, thingId: string) {
  const [row] = await db
    .select()
    .from(things)
    .where(and(eq(things.id, thingId), eq(things.userId, userId)))
    .limit(1);
  if (!row) throw new TRPCError({ code: 'NOT_FOUND' });
}
```

**Rules:**
- `TRPCError` is the only way to fail — never `return null` or `return { error: '...' }`
- Common codes: `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `BAD_REQUEST`
- Pull shared limits/defaults from `src/lib/constants.ts`, not inline magic numbers
- Services are reusable — callable from other services or `serverTrpc()` in server components

---

## Validation Pattern

```ts
// src/lib/validations/things.ts
import { z } from 'zod';

export const ThingSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  createdAt: z.string(),
});
export type Thing = z.infer<typeof ThingSchema>;

export const CreateThingInputSchema = z.object({
  name: z.string().min(1),
});
export type CreateThingInput = z.infer<typeof CreateThingInputSchema>;
```

**Rules:**
- Always export both the schema and its inferred type — never one without the other
- Schema goes into `.input()`. Type goes into service function signatures
- Output/entity schemas (e.g. `ThingSchema`) live here too — use for `.output()` when needed

---

## Constants

```ts
// src/lib/constants.ts
export const MAX_PROJECTS = 10;
export const DEFAULT_PAGE_SIZE = 25;
```

Use `src/lib/constants.ts` for any shared limit, default, or config value. Don't inline magic numbers across services and validations.

---

## Server Actions (forms only)

```ts
// src/app/(auth)/actions.ts
"use server";
import { validatedAction } from "@/lib/action-helpers";
import { LoginSchema } from "@/lib/validations/auth";

export const signInAction = validatedAction(LoginSchema, async (data) => {
  // data is fully typed and validated from FormData
});
```

Use `validatedAction` for auth forms and any `useActionState` server action. tRPC handles everything else — don't use server actions for data fetching or mutations that could be tRPC procedures.

---

## Anti-Patterns

```ts
// ❌ DB logic in a router
create: protectedProcedure
  .input(CreateThingInputSchema)
  .mutation(({ ctx, input }) => db.insert(things).values({ ...input, userId: ctx.userId }))

// ❌ userId from input
.input(z.object({ userId: z.string() }))
.query(({ input }) => getThings(input.userId))

// ❌ returning null instead of throwing
export async function getThing(userId: string, id: string) {
  const row = await db.select()...
  return row ?? null; // client has to null-check everywhere
}

// ❌ inline magic numbers
.input(z.object({ page: z.number().max(50) }))  // where does 50 come from?

// ❌ missing server-only
// A router or service without `import 'server-only'` can be accidentally
// imported in a client component and leak secrets at runtime
```
