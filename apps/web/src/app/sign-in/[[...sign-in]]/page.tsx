import { SignIn } from "@clerk/nextjs";

export default function SignInPage() {
  return (
    <div className="min-h-screen bg-[#FAFAF8] flex items-center justify-center">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <span className="text-2xl font-bold text-stone-900 tracking-tight">
            QYRO
          </span>
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
