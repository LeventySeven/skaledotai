import Link from "next/link"
import Image from "next/image"

import { SignUpForm } from "@/components/auth/signup-form"

export default function SignUpPage() {
  return (
    <div className="grid min-h-[100dvh] lg:grid-cols-2">
      <div className="flex flex-col bg-[#F8FAFC]">
        <div className="flex shrink-0 justify-center gap-2 px-5 pt-6 sm:px-6 md:justify-start md:px-8 md:pt-10">
          <Link href="/" className="flex items-center gap-2 font-medium text-foreground">
            <div className="bg-primary text-primary-foreground flex size-6 items-center justify-center rounded-md">
              <Image src="/logo-v1.svg" alt="Logo" width={24} height={24} />
            </div>
            mark
          </Link>
        </div>
        <div className="flex flex-1 items-center justify-center px-5 py-6 sm:px-6 md:px-8">
          <div className="w-full max-w-xs">
            <SignUpForm />
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
