import type { Metadata } from "next";
import type { ReactNode } from "react";

import { SiteNav } from "@/components/controls";

import "./globals.css";

export const metadata: Metadata = {
  title: "IndexCore Reference Web",
  description: "Disposable reference consumer for the IndexCore read-only /v1 HTTP contract.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="topbar">
          <strong>IndexCore Reference Web</strong>
          <SiteNav />
          <span className="badge">disposable · not CloudSite 2</span>
        </header>
        <main className="page">{children}</main>
      </body>
    </html>
  );
}