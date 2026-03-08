import { Suspense } from "react"
import Link from "next/link"
import Image from "next/image"

import { LoginForm } from "@/components/auth/login-form"

export default function SignInPage() {
  return (
    <div className="grid min-h-[100dvh] lg:grid-cols-2">
      <div className="dark flex flex-col bg-background text-white">
        <div className="flex shrink-0 justify-center gap-2 px-5 pt-6 sm:px-6 md:justify-start md:px-8 md:pt-10">
          <Link href="/" className="flex items-center gap-2 font-medium">
            <div className="bg-primary text-primary-foreground flex size-6 items-center justify-center rounded-md">
              <Image src="/logo-v1.svg" alt="Logo" width={24} height={24} />
            </div>
            mark
          </Link>
        </div>
        <div className="flex flex-1 items-center justify-center px-5 py-6 sm:px-6 md:px-8">
          <div className="w-full max-w-xs">
            <Suspense fallback={<div className="text-center">Loading...</div>}>
              <LoginForm />
            </Suspense>
          </div>
        </div>
      </div>
      <div className="bg-muted relative hidden lg:block">
        <Image
          src="/auth-background.png"
          alt="Background"
          width={1258}
          height={1306}
          priority
          className="absolute inset-0 h-full w-full object-cover dark:grayscale"
        />
      </div>
    </div>
  )
}
