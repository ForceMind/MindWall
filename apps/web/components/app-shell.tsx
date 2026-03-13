"use client";

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

type AppShellProps = {
  title: string;
  subtitle: string;
  actions?: ReactNode;
  status?: ReactNode;
  children: ReactNode;
};

const tabs = [
  { href: '/contacts', label: '联系人' },
  { href: '/chat', label: '聊天' },
];

function isActive(pathname: string, href: string) {
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
      <div className="mw-container">
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
                aria-current={active ? 'page' : undefined}
                className={`flex h-11 items-center justify-center rounded-xl border text-sm font-medium transition ${
                  active
                    ? 'border-zinc-950 bg-zinc-950 text-white'
                    : 'border-zinc-200 bg-white text-zinc-700'
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
      <div className="mw-container">
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
      <div className="mw-container">
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
