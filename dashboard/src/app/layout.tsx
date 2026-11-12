import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Providers } from "@/components/providers";
import { themeScript } from "@/components/theme";
import { readRuntimeConfig } from "@/lib/runtime";
import "./globals.css";

const sans = Geist({ subsets: ["latin"], variable: "--font-sans", display: "swap" });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-mono", display: "swap" });

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { default: "Federix", template: "%s · Federix" },
  description: "Operate your Federix federated learning network",
  icons: { icon: "/icon.svg" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f5f7fa" },
    { media: "(prefers-color-scheme: dark)", color: "#080c12" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const config = readRuntimeConfig();
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <Providers config={config}>{children}</Providers>
      </body>
    </html>
  );
}
