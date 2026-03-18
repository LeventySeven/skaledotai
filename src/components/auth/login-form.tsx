"use client"

import { useActionState } from "react"
import { useSearchParams } from "next/navigation"
import Link from "next/link"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { SubmitButton } from "@/components/auth/submit-button"
import { FormError } from "@/components/auth/form-errors"
import { GoogleIcon, XIcon } from "@/components/auth/icons"

import { signInAction } from "@/app/(auth)/actions"
import { authClient } from "@/lib/auth-client"

export function LoginForm({ className, ...props }: React.ComponentProps<"form">) {
  const [state, formAction] = useActionState(signInAction, { error: "" })
  const searchParams = useSearchParams()
  const callbackUrlParam = searchParams?.get("callbackUrl")
  const callbackUrl = callbackUrlParam?.startsWith("/") ? callbackUrlParam : "/"

  const handleSocialAuth = async (provider: "google" | "twitter") => {
    try {
      await authClient.signIn.social({
        provider,
        callbackURL: callbackUrl,
      })
    } catch (error) {
      console.error(`${provider} auth error:`, error)
    }
  }

  return (
    <form className={cn("flex flex-col gap-6", className)} action={formAction} {...props}>
      <input type="hidden" name="callbackUrl" value={callbackUrl} />
      <div className="flex flex-col items-center gap-2 text-center">
        <h1 className="text-2xl font-bold">Login to your account</h1>
        <p className="text-muted-foreground text-sm text-balance">Enter your email below to login</p>
      </div>

      <div className="grid gap-4">
        <FormError message={state?.error} />

        <div className="grid gap-2">
          <Label htmlFor="email">Email</Label>
          <Input id="email" name="email" type="email" required />
        </div>
        <div className="grid gap-2">
          <div className="flex items-center">
            <Label htmlFor="password">Password</Label>
          </div>
          <Input id="password" name="password" type="password" required />
        </div>

        <SubmitButton pendingText="Signing in..." className="w-full">
          Login
        </SubmitButton>
      </div>

      <div className="after:border-border relative text-center text-sm after:absolute after:inset-0 after:top-1/2 after:z-0 after:flex after:items-center after:border-t">
        <span className="bg-background text-muted-foreground relative z-10 px-2">or continue with</span>
      </div>

      <div className="flex flex-col gap-3">
        <Button type="button" variant="outline" className="w-full" onClick={() => handleSocialAuth("google")}>
          <GoogleIcon className="mr-2 h-4 w-4" /> Continue with Google
        </Button>
        <Button type="button" variant="outline" className="w-full" onClick={() => handleSocialAuth("twitter")}>
          <XIcon className="mr-2 h-4 w-4" /> Continue with X
        </Button>
      </div>

      <div className="text-center text-sm">
        <span className="text-muted-foreground">Don&apos;t have an account? </span>
        <Link href={`/sign-up?callbackUrl=${encodeURIComponent(callbackUrl)}`} className="underline-offset-4 hover:underline">
          Sign up
        </Link>
      </div>
    </form>
  )
}
