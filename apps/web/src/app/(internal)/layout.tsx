import { auth } from "@clerk/nextjs/server";
import InternalSidebar from "@/components/sidebar/InternalSidebar";

const API_URL = process.env.API_URL ?? "http://localhost:3005";

export default async function InternalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Fetch approval count for sidebar badge — lightweight, no-store
  let approvalCount = 0;
  try {
    const { getToken } = await auth();
    const token = await getToken();
    if (token) {
      const res = await fetch(`${API_URL}/api/campaigns/queue`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      if (res.ok) {
        const body = await res.json();
        approvalCount = body.count ?? 0;
      }
    }
  } catch {
    // Badge stays 0 on error — non-critical
  }

  return (
    <div className="flex h-screen bg-[#FAFAF8]">
      <InternalSidebar approvalCount={approvalCount} />
      <main className="flex-1 overflow-y-auto pt-14 md:pt-0">
        {children}
      </main>
    </div>
  );
}
