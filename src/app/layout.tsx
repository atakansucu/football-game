import type { Metadata, Viewport } from "next";
import "./globals.css";
import { NativeInit } from "@/components/NativeInit";

export const metadata: Metadata = {
  title: "3-2-1 Football",
  description: "Guess the footballer before the clock runs out",
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
        <div className="app-shell">
          <div className="safe-area mx-auto flex min-h-full w-full max-w-md flex-col sm:max-w-lg">
            {children}
          </div>
        </div>
      </body>
    </html>
  );
}
