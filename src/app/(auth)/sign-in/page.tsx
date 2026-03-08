import { Suspense } from "react"
import Link from "next/link"
import Image from "next/image"

import { LoginForm } from "@/components/auth/login-form"

export default function SignInPage() {
  return (
    <div className="grid min-h-[100dvh] lg:grid-cols-2">
      <div className="flex flex-col bg-[#F8FAFC]">
        <div className="flex shrink-0 justify-center gap-2 px-5 pt-6 sm:px-6 md:justify-start md:px-8 md:pt-10">
          <Link href="/" className="font-semibold text-foreground tracking-tight">
            skaleai
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
      <div className="relative hidden lg:block">
        <Image
          src="/skale-auth.png"
          alt="Background"
          fill
          priority
          className="object-cover"
        />
      </div>
    </div>
  )
}
