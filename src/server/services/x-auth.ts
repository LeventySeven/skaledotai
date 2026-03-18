import "@/lib/server-runtime";
import { eq, and } from "drizzle-orm";
import { db } from "@/db";
import { account } from "@/db/schema";

/**
 * Retrieve the user's X/Twitter OAuth 2.0 access token.
 *
 * Stored in the `account` table by better-auth when the user connects
 * their X account via the Twitter social provider.
 *
 * If the token is expired and a refresh token exists, attempts to refresh it
 * via X's OAuth 2.0 token endpoint.
 *
 * Returns null if the user hasn't connected X or the token can't be refreshed.
 */
export async function getXAccessToken(userId: string): Promise<string | null> {
  const [row] = await db
    .select({
      accessToken: account.accessToken,
      refreshToken: account.refreshToken,
      accessTokenExpiresAt: account.accessTokenExpiresAt,
      id: account.id,
    })
    .from(account)
    .where(and(
      eq(account.userId, userId),
      eq(account.providerId, "twitter"),
    ))
    .limit(1);

  if (!row?.accessToken) return null;

  // Check if token is expired (with 5-minute buffer)
  if (row.accessTokenExpiresAt) {
    const expiresAt = new Date(row.accessTokenExpiresAt).getTime();
    const now = Date.now();
    const bufferMs = 5 * 60 * 1000;

    if (now > expiresAt - bufferMs) {
      // Token is expired or about to expire — try refresh
      if (row.refreshToken) {
        const refreshed = await refreshXAccessToken(row.refreshToken, row.id);
        return refreshed;
      }
      return null;
    }
  }

  return row.accessToken;
}

/**
 * Check whether a user has connected their X account (without retrieving the token).
 */
export async function hasXAccountConnected(userId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: account.id })
    .from(account)
    .where(and(
      eq(account.userId, userId),
      eq(account.providerId, "twitter"),
    ))
    .limit(1);

  return !!row;
}

/**
 * Disconnect (unlink) the user's X account by removing the twitter provider row.
 */
export async function disconnectXAccount(userId: string): Promise<void> {
  await db
    .delete(account)
    .where(and(
      eq(account.userId, userId),
      eq(account.providerId, "twitter"),
    ));
}

/**
 * In-memory lock to prevent concurrent token refreshes for the same account.
 * X uses refresh token rotation — concurrent refreshes would invalidate each other.
 */
const refreshLocks = new Map<string, Promise<string | null>>();

/**
 * Refresh an expired X OAuth 2.0 access token.
 * Uses an in-memory lock per account to prevent concurrent refresh races.
 *
 * X OAuth 2.0 token refresh endpoint:
 * POST https://api.x.com/2/oauth2/token
 * Content-Type: application/x-www-form-urlencoded
 * Body: grant_type=refresh_token&refresh_token=...&client_id=...
 *
 * Docs: https://docs.x.com/resources/fundamentals/authentication/guides/v2-authentication-mapping
 */
async function refreshXAccessToken(refreshToken: string, accountId: string): Promise<string | null> {
  const existing = refreshLocks.get(accountId);
  if (existing) {
    return existing;
  }

  const promise = doRefreshXAccessToken(refreshToken, accountId).finally(() => {
    refreshLocks.delete(accountId);
  });
  refreshLocks.set(accountId, promise);
  return promise;
}

async function doRefreshXAccessToken(refreshToken: string, accountId: string): Promise<string | null> {
  const clientId = process.env.X_CLIENT_ID?.trim();
  if (!clientId) {
    console.warn("[x-auth] X_CLIENT_ID not set, cannot refresh token");
    return null;
  }

  try {
    const response = await fetch("https://api.x.com/2/oauth2/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: clientId,
      }),
    });

    if (!response.ok) {
      console.warn("[x-auth] Token refresh failed:", response.status, await response.text().catch(() => ""));
      return null;
    }

    const data = await response.json() as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
    };

    if (!data.access_token) return null;

    // Update the stored tokens in the database
    const expiresAt = data.expires_in
      ? new Date(Date.now() + data.expires_in * 1000)
      : null;

    await db
      .update(account)
      .set({
        accessToken: data.access_token,
        refreshToken: data.refresh_token ?? refreshToken,
        ...(expiresAt ? { accessTokenExpiresAt: expiresAt } : {}),
        updatedAt: new Date(),
      })
      .where(eq(account.id, accountId));

    return data.access_token;
  } catch (error) {
    console.warn("[x-auth] Token refresh error:", error instanceof Error ? error.message : error);
    return null;
  }
}
