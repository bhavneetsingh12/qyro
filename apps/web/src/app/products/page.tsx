import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

export default async function ProductsPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  return (
    <main className="min-h-screen bg-[#F7F6F2] flex items-center justify-center px-4">
      <div className="w-full max-w-3xl">
        <h1 className="text-3xl md:text-4xl font-semibold text-stone-900 text-center">Choose Product</h1>
        <p className="text-stone-600 text-center mt-2">
          QYRO Lead and QYRO Assist are separate product surfaces under the same company account.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-8">
          <Link
            href="/lead"
            className="block rounded-2xl border border-stone-200 bg-white p-6 hover:shadow-sm transition-shadow"
          >
            <p className="text-xs uppercase tracking-wide text-stone-500">Product</p>
            <h2 className="text-xl font-semibold text-stone-900 mt-1">QYRO Lead</h2>
            <p className="text-sm text-stone-600 mt-2">
              Internal lead sourcing, research, campaign drafting, and approvals.
            </p>
          </Link>

          <Link
            href="/assist"
            className="block rounded-2xl border border-stone-200 bg-white p-6 hover:shadow-sm transition-shadow"
          >
            <p className="text-xs uppercase tracking-wide text-stone-500">Product</p>
            <h2 className="text-xl font-semibold text-stone-900 mt-1">QYRO Assist</h2>
            <p className="text-sm text-stone-600 mt-2">
              Client assistant workflows: conversations, bookings, calls, approvals, and widget setup.
            </p>
          </Link>
        </div>
      </div>
    </main>
  );
}
