import type { Metadata } from "next";

import { env } from "@/lib/env";
import { Toaster } from "@/components/ui/toast";
import { SessionMaintenance } from "@/components/auth/session-maintenance";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(env.APP_URL),
  applicationName: "Welio",
  title: {
    default: "Welio | Bookings and customers",
    template: "%s | Welio",
  },
  description:
    "Manage bookings, customer details, and service schedules. Welio's AI receptionist answers questions and helps customers book.",
  robots: {
    index: false,
    follow: false,
    googleBot: { index: false, follow: false },
  },
  openGraph: {
    type: "website",
    siteName: "Welio",
    title: "Welio | Bookings and customers",
    description:
      "Manage bookings, customer details, and service schedules. Welio's AI receptionist answers questions and helps customers book.",
  },
  twitter: {
    card: "summary_large_image",
    title: "Welio | Bookings and customers",
    description:
      "Manage bookings, customer details, and service schedules. Welio's AI receptionist answers questions and helps customers book.",
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full overflow-x-clip antialiased">
      <body className="min-h-full overflow-x-clip">
        <SessionMaintenance />
        {children}
        <Toaster />
      </body>
    </html>
  );
}
