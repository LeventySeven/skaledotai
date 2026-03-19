import "@/lib/server-runtime";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "@/db";
import * as schema from "@/db/schema";
import { nextCookies } from "better-auth/next-js";

function readEnv(name: string): string | undefined {
    const value = process.env[name]?.trim();
    return value ? value : undefined;
}

const betterAuthUrl = readEnv("BETTER_AUTH_URL");
const publicAppUrl = readEnv("NEXT_PUBLIC_APP_URL");
const googleClientId = readEnv("GOOGLE_CLIENT_ID");
const googleClientSecret = readEnv("GOOGLE_CLIENT_SECRET");
const twitterClientId = readEnv("X_CLIENT_ID");
const twitterClientSecret = readEnv("X_CLIENT_SECRET");

export const auth = betterAuth({
    trustedOrigins: Array.from(new Set([
        betterAuthUrl,
        publicAppUrl,
        ...(process.env.NODE_ENV === "development" ? ["http://localhost:3000"] : []),
    ].filter((value): value is string => Boolean(value)))),
    database: drizzleAdapter(db, {
        provider: "pg",
        schema,
    }),
    account: {
        accountLinking: {
            enabled: true,
            trustedProviders: ["google", "twitter"],
            allowDifferentEmails: true,
        },
    },
    emailAndPassword: {
        enabled: true,
        requireEmailVerification: false,
    },
    socialProviders: {
        ...(googleClientId && googleClientSecret ? {
            google: {
                clientId: googleClientId,
                clientSecret: googleClientSecret,
                accessType: "offline",
                prompt: "select_account consent",
            },
        } : {}),
        ...(twitterClientId && twitterClientSecret ? {
            twitter: {
                clientId: twitterClientId,
                clientSecret: twitterClientSecret,
                scope: ["tweet.read", "users.read", "dm.write", "dm.read", "offline.access"],
            },
        } : {}),
    },
    rateLimit: {
        enabled: true,
        window: 60,
        max: 100,
        customRules: {
            "/sign-in/social": {
                window: 10,
                max: 10,
            },
            "/callback/*": {
                window: 10,
                max: 10,
            },
        },
    },
    plugins: [nextCookies()],
});
