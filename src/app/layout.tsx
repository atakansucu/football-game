import type { Metadata, Viewport } from "next";
import "./globals.css";
import { NativeInit } from "@/components/NativeInit";

export const metadata: Metadata = {
  title: "Football Duel",
  description: "Real-time 2-player football knowledge duel",
};

export const viewport: Viewport = {
  themeColor: "#04140b",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning>
        <NativeInit />
        <div className="safe-area mx-auto flex min-h-full w-full max-w-md flex-col px-4 sm:max-w-lg">
          {children}
        </div>
      </body>
    </html>
  );
}
