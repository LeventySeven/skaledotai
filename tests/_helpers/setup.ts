/**
 * Global test setup — preloaded by bun test via bunfig.toml.
 * Stubs environment variables that would otherwise crash module imports.
 */
process.env.DATABASE_URL ??= "postgres://test:test@localhost:5432/test";
process.env.BETTER_AUTH_URL ??= "http://localhost:3000";
process.env.GOOGLE_CLIENT_ID ??= "test-client-id";
process.env.GOOGLE_CLIENT_SECRET ??= "test-client-secret";
process.env.OPENAI_API_KEY ??= "sk-test";
