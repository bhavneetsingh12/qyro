import { SignIn } from "@clerk/nextjs";
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
      </div>
    </div>
  );
}
