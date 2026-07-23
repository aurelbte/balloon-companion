import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { FlightRuntimeProvider } from "./contexts/FlightRuntimeContext";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  applicationName: "Balloon Companion",
  title: {
    default: "Balloon Companion",
    template: "%s · Balloon Companion",
  },
  description: "Le copilote numérique des pilotes de montgolfière.",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Balloon Companion",
  },
  formatDetection: {
    telephone: false,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <FlightRuntimeProvider>{children}</FlightRuntimeProvider>
      </body>
    </html>
  );
}
