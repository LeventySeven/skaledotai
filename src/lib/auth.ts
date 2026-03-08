import 'server-only'
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "@/db";
import { nextCookies } from "better-auth/next-js";

export const auth = betterAuth({
    trustedOrigins: [
        process.env.BETTER_AUTH_URL!,
        ...(process.env.NODE_ENV === 'development' ? ["http://localhost:3000"] : []),
    ].filter(Boolean),
    database: drizzleAdapter(db, {
        provider: "pg",
    }),
    account: {
        accountLinking: {
            enabled: true,
            trustedProviders: ["google"],
            allowDifferentEmails: true,
        },
    },
    emailAndPassword: {
        enabled: true,
        requireEmailVerification: false,
    },
    socialProviders: {
        google: {
            clientId: process.env.GOOGLE_CLIENT_ID as string,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET as string,
            accessType: "offline",
            prompt: "select_account consent",
        },
    },
    plugins: [nextCookies()],
});
