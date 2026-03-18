"use client"

import * as React from "react"
import { AlertCircle } from "lucide-react"
import { useActionState } from "react"
import { useSearchParams } from "next/navigation"
import Link from "next/link"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { GoogleIcon, XIcon } from "@/components/auth/icons"
import { SubmitButton } from "@/components/auth/submit-button"
import { FormError } from "@/components/auth/form-errors"

import { signUpAction } from "@/app/(auth)/actions"
import { authClient } from "@/lib/auth-client"

export function SignUpForm({ className, ...props }: React.ComponentProps<"form">) {
  const [state, formAction] = useActionState(signUpAction, { error: "" })
  const searchParams = useSearchParams()
  const callbackUrlParam = searchParams?.get("callbackUrl")
  const callbackUrl = callbackUrlParam?.startsWith("/") ? callbackUrlParam : "/"

  const [password, setPassword] = React.useState("")
  const [isFocused, setIsFocused] = React.useState(false)
  const [isInvalid, setIsInvalid] = React.useState(false)

  const handlePasswordChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newPassword = e.target.value
    setPassword(newPassword)
    if (isInvalid && newPassword.length >= 8) {
      setIsInvalid(false)
    }
  }

  const handlePasswordBlur = () => {
    setIsFocused(false)
    if (password.length > 0 && password.length < 8) {
      setIsInvalid(true)
    } else {
      setIsInvalid(false)
    }
  }

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
        <h1 className="text-2xl font-bold">Create your account</h1>
        <p className="text-muted-foreground text-sm text-balance">Welcome! Please fill in the details to get started.</p>
      </div>

      <div className="grid gap-4">
        <FormError message={state?.error} />

        <div className="grid gap-2">
          <Label htmlFor="name">Name</Label>
          <Input id="name" name="name" type="text" required />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="email">Email</Label>
          <Input id="email" name="email" type="email" required />
        </div>

        <div className="grid gap-2">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            name="password"
            type="password"
            required
            className={cn(isInvalid && "border-destructive")}
            value={password}
            onChange={handlePasswordChange}
            onFocus={() => setIsFocused(true)}
            onBlur={handlePasswordBlur}
          />
          {(isFocused || isInvalid) && (
            <p className={cn("text-xs flex items-center gap-1", isInvalid ? "text-destructive" : "text-muted-foreground")}>
              {isInvalid && <AlertCircle className="h-3 w-3" />}
              Your password must contain 8 or more characters.
            </p>
          )}
        </div>

        <SubmitButton pendingText="Creating account..." className="w-full">
          Sign up
        </SubmitButton>
      </div>

      <div className="after:border-border relative text-center text-sm after:absolute after:inset-0 after:top-1/2 after:z-0 after:flex after:items-center after:border-t">
        <span className="bg-background text-muted-foreground relative z-10 px-2">or</span>
      </div>

      <div className="flex flex-col gap-3">
        <Button type="button" variant="outline" onClick={() => handleSocialAuth("google")}>
          <GoogleIcon className="mr-2 h-4 w-4" /> Continue with Google
        </Button>
        <Button type="button" variant="outline" onClick={() => handleSocialAuth("twitter")}>
          <XIcon className="mr-2 h-4 w-4" /> Continue with X
        </Button>
      </div>

      <div className="text-center text-sm">
        <span className="text-muted-foreground">Already have an account? </span>
        <Link href={`/sign-in?callbackUrl=${encodeURIComponent(callbackUrl)}`} className="underline-offset-4 hover:underline">
          Sign in
        </Link>
      </div>
    </form>
  )
}
