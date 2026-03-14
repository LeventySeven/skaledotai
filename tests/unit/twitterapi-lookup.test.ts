import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

const fetchMock = mock();

const originalFetch = globalThis.fetch;

beforeEach(() => {
  process.env.TWITTERAPI_IO_KEY = "twitterapi-key";
  fetchMock.mockReset();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

const { lookupTwitterApiUsersByIds } = await import("@/lib/x/twitterapi");

describe("lookupTwitterApiUsersByIds", () => {
  test("maps TwitterAPI.io batch lookup responses into canonical X profiles", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      users: [
        {
          id: "42",
          userName: "dustin",
          name: "Dustin Senos",
          url: "https://x.com/dustin",
          isBlueVerified: true,
          verifiedType: "blue",
          profilePicture: "https://cdn.example.com/avatar.jpg",
          description: "Head of design building browser tools",
          location: "San Francisco, CA",
          followers: 17300,
          following: 1300,
          statusesCount: 5400,
          profile_bio: {
            description: "always learning",
            entities: {
              url: {
                urls: [
                  {
                    expanded_url: "https://diabrowser.com",
                  },
                ],
              },
            },
          },
        },
      ],
      status: "success",
    }), {
      status: 200,
      headers: {
        "content-type": "application/json",
      },
    }));

    const profiles = await lookupTwitterApiUsersByIds(["42"]);

    expect(fetchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        href: "https://api.twitterapi.io/twitter/user/batch_info_by_ids?userIds=42",
      }),
      expect.objectContaining({
        headers: expect.objectContaining({
          "X-API-Key": "twitterapi-key",
        }),
      }),
    );

    expect(profiles).toEqual([
      expect.objectContaining({
        xUserId: "42",
        username: "dustin",
        displayName: "Dustin Senos",
        bio: "Head of design building browser tools",
        location: "San Francisco, CA",
        followersCount: 17300,
        followingCount: 1300,
        tweetCount: 5400,
        verified: true,
        verifiedType: "blue",
        url: "https://diabrowser.com",
      }),
    ]);
  });
});
