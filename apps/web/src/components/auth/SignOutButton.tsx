"use client";

import { useClerk } from "@clerk/nextjs";

export default function SignOutButton({
  className,
  label = "Sign out",
}: {
  className?: string;
  label?: string;
}) {
  const { signOut } = useClerk();

  return (
    <button
      type="button"
      onClick={() => signOut({ redirectUrl: "/" })}
      className={className}
    >
      {label}
    </button>
  );
}
