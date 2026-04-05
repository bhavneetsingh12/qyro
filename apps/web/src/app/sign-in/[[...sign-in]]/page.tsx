import { SignIn } from "@clerk/nextjs";
import Link from "next/link";
import { QyroBrandLockup } from "@/components/brand/QyroBrand";

export default function SignInPage() {
  return (
    <div className="min-h-screen bg-[#FAFAF8] flex items-center justify-center">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <QyroBrandLockup surface="core" subtitle="Lead engine and client assistant" align="center" />
          <p className="text-sm text-stone-500 mt-1">Sign in to continue</p>
        </div>
        <SignIn
          appearance={{
            elements: {
              card: "shadow-sm border border-stone-200 rounded-xl",
              headerTitle: "hidden",
              headerSubtitle: "hidden",
            },
          }}
        />
        <p className="text-center text-xs text-stone-400 mt-5">
          By continuing, you agree to our{" "}
          <Link href="/terms" className="text-stone-600 hover:text-stone-900 underline">Terms of Service</Link>
          {" "}and{" "}
          <Link href="/privacy" className="text-stone-600 hover:text-stone-900 underline">Privacy Policy</Link>
        </p>
      </div>
    </div>
  );
}
