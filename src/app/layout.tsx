import type { Metadata } from "next";

import { env } from "@/lib/env";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(env.APP_URL),
  applicationName: "Welio",
  title: {
    default: "Welio | Business dashboard",
    template: "%s | Welio",
  },
  description:
    "Manage appointments, customers, services, and your AI receptionist in one place with Welio.",
  robots: {
    index: false,
    follow: false,
    googleBot: { index: false, follow: false },
  },
  openGraph: {
    type: "website",
    siteName: "Welio",
    title: "Welio | Business dashboard",
    description:
      "Manage appointments, customers, services, and your AI receptionist in one place.",
  },
  twitter: {
    card: "summary_large_image",
    title: "Welio | Business dashboard",
    description:
      "Manage appointments, customers, services, and your AI receptionist in one place.",
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full overflow-x-clip antialiased">
      <body className="min-h-full overflow-x-clip">
        {children}
        <Toaster />
      </body>
    </html>
  );
}
