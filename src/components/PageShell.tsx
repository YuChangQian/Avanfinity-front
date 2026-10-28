import type { ReactNode } from "react";

export function PageShell({ eyebrow, title, description, children, className = "" }: {
  eyebrow: string; title: string; description: string; children: ReactNode; className?: string;
}) {
  return <main className={`finance-page ${className}`}>
    <header><div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{description}</p></div></header>
    {children}
  </main>;
}

export function DataSkeleton({ className = "" }: { className?: string }) {
  return <span className={`loading-skeleton loading-skeleton-inline ${className}`.trim()} aria-hidden="true">Loading</span>;
}
