import type { Metadata } from "next";
import { headers } from "next/headers";
import type { ReactNode } from "react";

import "./globals.css";

export const metadata: Metadata = { title: "WebDoc", description: "Local project documentation" };

export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  await (await headers()).get("x-nonce");
  return <html lang="en"><body>{children}</body></html>;
}
