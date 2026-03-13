"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

type AppShellProps = {
  title: string;
  subtitle: string;
  actions?: ReactNode;
  status?: ReactNode;
  children: ReactNode;
};

const tabs = [
  { href: "/", label: "访谈" },
  { href: "/matches", label: "匹配" },
  { href: "/sandbox", label: "聊天" },
  { href: "/companion", label: "陪练" },
];

function isActive(pathname: string, href: string) {
  if (href === "/") {
    return pathname === "/";
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AppShell({
  title,
  subtitle,
  actions,
  status,
  children,
}: AppShellProps) {
  const pathname = usePathname();

  return (
    <div className="mw-app-bg">
      <div className="mw-device">
        <header className="mw-header">
          <div className="mw-header-top">
            <div>
              <p className="mw-header-kicker">MindWall</p>
              <h1 className="mw-header-title">{title}</h1>
              <p className="mw-header-subtitle">{subtitle}</p>
            </div>
            {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
          </div>
          {status ? <div className="mw-header-status">{status}</div> : null}
        </header>

        <main className="mw-content">{children}</main>

        <nav className="mw-tabbar">
          {tabs.map((tab) => {
            const active = isActive(pathname, tab.href);
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={`flex h-12 items-center justify-center rounded-2xl text-sm font-medium transition ${
                  active
                    ? "bg-zinc-950 text-white shadow-[0_8px_20px_rgba(15,23,42,0.18)]"
                    : "border border-black/6 bg-white/85 text-zinc-600"
                }`}
              >
                {tab.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </div>
  );
}

export function AppLoadingScreen({ label }: { label: string }) {
  return (
    <div className="mw-app-bg">
      <div className="mw-device">
        <div className="mw-centered">
          <div>
            <p className="mw-header-kicker">MindWall</p>
            <p className="mt-3 text-sm">{label}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

export function AuthShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <div className="mw-app-bg">
      <div className="mw-device">
        <header className="mw-header">
          <p className="mw-header-kicker">MindWall</p>
          <h1 className="mw-header-title">{title}</h1>
          <p className="mw-header-subtitle">{subtitle}</p>
        </header>
        <main className="mw-content">{children}</main>
      </div>
    </div>
  );
}
