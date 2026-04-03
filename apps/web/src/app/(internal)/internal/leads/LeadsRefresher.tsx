"use client";

import { useRouter } from "next/navigation";
import { FindLeadsButton } from "./FindLeadsModal";

export function LeadsRefresher() {
  const router = useRouter();
  return <FindLeadsButton onSuccess={() => router.refresh()} />;
}
