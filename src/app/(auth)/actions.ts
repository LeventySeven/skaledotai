"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getRequestSession } from "@/lib/auth-session";
import { SignUpSchema, LoginSchema } from "@/lib/validations/auth";
import { validatedAction } from "@/lib/action-helpers";
import { getErrorMessage } from "@/lib/utils";

export const signUpAction = validatedAction(SignUpSchema, async (data) => {
  const { name, email, password, callbackUrl } = data;

  try {
    const result = await auth.api.signUpEmail({
      body: { name, email, password },
    });

    if (!result || !result.user) {
      return { error: "Failed to create account" };
    }
  } catch (error: unknown) {
    console.error("Sign up error:", error);

    const errorMessage = getErrorMessage(error);
    if (errorMessage.toLowerCase().includes("user already exists") ||
        errorMessage.toLowerCase().includes("email already exists")) {
          return { error: "This email is already registered" };
        }
        return { error: errorMessage };
      }

  const redirectTo = callbackUrl?.startsWith("/") && !callbackUrl.startsWith("//") ? callbackUrl : "/";
  redirect(redirectTo);
});

export const signInAction = validatedAction(LoginSchema, async (data) => {
  const { email, password, callbackUrl } = data;

  try {
    const result = await auth.api.signInEmail({
      body: { email, password },
    });

    if (!result || !result.user) {
      return { error: "Invalid email or password" };
    }
  } catch (error: unknown) {
    console.error("Sign in error:", error);

    const errorMessage = getErrorMessage(error);
     if (errorMessage.toLowerCase().includes("invalid") ||
        errorMessage.toLowerCase().includes("incorrect")) {
          return { error: "Invalid email or password" };
    }
    return { error: errorMessage };
  }
  const redirectTo = callbackUrl?.startsWith("/") && !callbackUrl.startsWith("//") ? callbackUrl : "/";
  redirect(redirectTo);
});

export const signOutAction = async () => {
  try {
    await auth.api.signOut({
      headers: await headers(),
    });
  } catch (error: unknown) {
    console.error("Sign out error:", error);
  }

  redirect("/sign-in");
};

export const getCurrentSession = async () => {
  return getRequestSession();
};
