import { mock } from "bun:test";

/**
 * A chainable query builder that resolves to unknown[].
 * Every property access returns itself (for .from().where().limit() etc.)
 * and it's PromiseLike so it can be awaited.
 */
export type ChainableQuery = PromiseLike<unknown[]> & {
  [K: string]: (...args: unknown[]) => ChainableQuery;
};

export interface CapturedChainCall {
  table?: unknown;
  [method: string]: unknown;
}

export interface FakeDbCaptures {
  inserts: CapturedChainCall[];
  updates: CapturedChainCall[];
  selects: CapturedChainCall[];
  deletes: CapturedChainCall[];
}

export interface FakeDbOptions {
  /** Sequential results for each db.select() call — pops in order */
  selectResults?: unknown[][];
  /** Rows returned by insert().returning() */
  insertReturning?: unknown[];
  /** Rows returned by update().returning() */
  updateReturning?: unknown[];
  /** Rows returned by delete().returning() */
  deleteReturning?: unknown[];
}

function makeChain(resolveValue: unknown, capture?: CapturedChainCall): ChainableQuery {
  const self: ChainableQuery = new Proxy({} as ChainableQuery, {
    get(_target, prop) {
      if (prop === "then") {
        return (resolve: (v: unknown) => void) => resolve(resolveValue);
      }
      return (...args: unknown[]) => {
        if (capture) {
          capture[String(prop)] = args.length === 1 ? args[0] : args;
        }
        return self;
      };
    },
  });
  return self;
}

/**
 * Creates a mock `db` object matching how this repo's services call Drizzle:
 *   db.select().from().where()...
 *   db.insert(table).values().returning()
 *   db.update(table).set().where().returning()
 *   db.delete(table).where().returning()
 *
 * Usage:
 *   const db = fakeDb({
 *     selectResults: [[{ id: "p-1", name: "Test" }], [{ count: 5 }]],
 *     updateReturning: [{ id: "lead-1", stage: "messaged" }],
 *   });
 *   mock.module("@/db", () => ({ db }));
 */
export function fakeDb(options: FakeDbOptions = {}) {
  let selectCallIndex = 0;
  const selectResults = options.selectResults ?? [[]];
  const captures: FakeDbCaptures = { inserts: [], updates: [], selects: [], deletes: [] };

  return {
    select: mock((...fields: unknown[]) => {
      const results = selectResults[selectCallIndex] ?? selectResults[selectResults.length - 1] ?? [];
      selectCallIndex++;
      const capture: CapturedChainCall = { fields };
      captures.selects.push(capture);
      return makeChain(results, capture);
    }),
    insert: mock((...tableArgs: unknown[]) => {
      const capture: CapturedChainCall = { table: tableArgs[0] };
      captures.inserts.push(capture);
      return makeChain(options.insertReturning ?? [], capture);
    }),
    update: mock((...tableArgs: unknown[]) => {
      const capture: CapturedChainCall = { table: tableArgs[0] };
      captures.updates.push(capture);
      return makeChain(options.updateReturning ?? [], capture);
    }),
    delete: mock((...tableArgs: unknown[]) => {
      const capture: CapturedChainCall = { table: tableArgs[0] };
      captures.deletes.push(capture);
      return makeChain(options.deleteReturning ?? [], capture);
    }),
    captures,
  };
}

export type FakeDb = ReturnType<typeof fakeDb>;
