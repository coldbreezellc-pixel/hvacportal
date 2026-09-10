import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans, JetBrains_Mono } from "next/font/google";
import { SwRegister } from "@/components/SwRegister";
import "./globals.css";

// Self-hosted through next/font so the fonts are cached by the service worker
// and the app looks the same with no service.
const jakarta = Plus_Jakarta_Sans({ subsets: ["latin"], weight: ["400", "500", "600", "700", "800"], variable: "--font-jakarta", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], weight: ["500", "700"], variable: "--font-mono", display: "swap" });

export const metadata: Metadata = {
  title: "Penguin Maintenance · Inventory Tracker",
  description: "Penguin Maintenance @ Versant Media — parts and filter inventory for the Local 68 crew.",
  applicationName: "Penguin Maintenance",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/icon.svg", apple: "/apple-icon.png" },
  appleWebApp: { capable: true, statusBarStyle: "default", title: "Penguin" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#0d9488",
  viewportFit: "cover",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${jakarta.variable} ${mono.variable}`}>
      <body>
        {children}
        <SwRegister />
      </body>
    </html>
  );
}
