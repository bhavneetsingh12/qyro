"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  LayoutDashboard,
  Users,
  Megaphone,
  CheckSquare,
  Settings,
  LogOut,
  Menu,
  X,
  ArrowLeftRight,
} from "lucide-react";
import { useClerk } from "@clerk/nextjs";
import clsx from "clsx";
import { QyroBrandLockup } from "@/components/brand/QyroBrand";

type NavItem = {
  href: string;
  label: string;
  icon: React.ElementType;
  badge?: number;
};

function Logo() {
  return (
    <QyroBrandLockup surface="lead" product="Lead" subtitle="Internal workspace" />
  );
}

export default function InternalSidebar({ approvalCount = 0, canSwitchToAssist = false }: { approvalCount?: number; canSwitchToAssist?: boolean }) {
  const pathname = usePathname();
  const { signOut } = useClerk();
  const [mobileOpen, setMobileOpen] = useState(false);

  const navItems: NavItem[] = [
    { href: "/internal/dashboard", label: "Dashboard", icon: LayoutDashboard },
    { href: "/internal/leads",     label: "Leads",     icon: Users },
    { href: "/internal/campaigns", label: "Campaigns", icon: Megaphone },
    { href: "/internal/approvals", label: "Approvals", icon: CheckSquare, badge: approvalCount },
  ];

  function NavLinks({ onLinkClick }: { onLinkClick?: () => void }) {
    return (
      <>
        <nav className="flex-1 px-3 py-4 space-y-0.5">
          {navItems.map(({ href, label, icon: Icon, badge }) => {
            const active = pathname?.startsWith(href) ?? false;
            return (
              <Link
                key={href}
                href={href}
                onClick={onLinkClick}
                className={clsx("sidebar-link", active && "sidebar-link-active")}
              >
                <Icon size={16} strokeWidth={1.75} />
                <span className="flex-1">{label}</span>
                {badge != null && badge > 0 && (
                  <span className="ml-auto text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-500 text-white leading-none">
                    {badge > 99 ? "99+" : badge}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        <div className="px-3 py-4 border-t border-[#E8E6E1] space-y-0.5">
          {canSwitchToAssist && (
            <Link href="/client/dashboard" onClick={onLinkClick} className="sidebar-link">
              <ArrowLeftRight size={16} strokeWidth={1.75} />
              Switch to QYRO Assist
            </Link>
          )}
          <Link href="/internal/settings" onClick={onLinkClick} className={clsx("sidebar-link", pathname?.startsWith("/internal/settings") && "sidebar-link-active")}>
            <Settings size={16} strokeWidth={1.75} />
            Settings
          </Link>
          <button
            onClick={() => signOut({ redirectUrl: "/sign-in" })}
            className="sidebar-link w-full text-left"
          >
            <LogOut size={16} strokeWidth={1.75} />
            Sign out
          </button>
        </div>
      </>
    );
  }

  return (
    <>
      {/* Mobile top bar — fixed, only visible below md */}
      <div className="fixed top-0 left-0 right-0 z-40 flex items-center gap-3 px-4 h-14 bg-[#F5F4F1] border-b border-[#E8E6E1] md:hidden">
        <button
          onClick={() => setMobileOpen(true)}
          className="p-1.5 rounded-lg text-stone-600 hover:bg-stone-100 transition-colors"
          aria-label="Open navigation"
        >
          <Menu size={20} strokeWidth={1.75} />
        </button>
        <Logo />
      </div>

      {/* Mobile drawer overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div
            className="absolute inset-0 bg-black/20"
            onClick={() => setMobileOpen(false)}
          />
          <aside
            className="absolute top-0 left-0 bottom-0 w-64 flex flex-col bg-[#F5F4F1] border-r border-[#E8E6E1]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-[#E8E6E1]">
              <Logo />
              <button
                onClick={() => setMobileOpen(false)}
                className="p-1.5 rounded-lg text-stone-400 hover:bg-stone-100 transition-colors"
                aria-label="Close navigation"
              >
                <X size={16} />
              </button>
            </div>
            <NavLinks onLinkClick={() => setMobileOpen(false)} />
          </aside>
        </div>
      )}

      {/* Desktop sidebar — hidden below md */}
      <aside className="hidden md:flex w-56 shrink-0 flex-col h-screen bg-[#F5F4F1] border-r border-[#E8E6E1]">
        <div className="px-5 py-5 border-b border-[#E8E6E1]">
          <Logo />
        </div>
        <NavLinks />
      </aside>
    </>
  );
}
