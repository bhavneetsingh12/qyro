import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

// Root route — redirect based on who is signed in.
// For now we redirect all authenticated users to /internal/dashboard
// (Bhavneet is the only user in Phase 2 internal use).
// In Phase 2 client onboarding we'll check tenant_type from DB.
export default async function RootPage() {
  const { userId } = await auth();

  if (!userId) {
    redirect("/sign-in");
  }

  // Default: send to internal portal.
  // Phase 2 client routing will be added in Session N.
  redirect("/internal/dashboard");
}
