import type { Metadata } from "next";
import { Suspense } from "react";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { FlightRuntimeProvider } from "./contexts/FlightRuntimeContext";
import { BalloonAuthProvider } from "./contexts/AuthContext";
import GpsStatsDiagnosticRunner from "./components/dev/GpsStatsDiagnosticRunner";
import LocalDataMigrationDialog from "./components/auth/LocalDataMigrationDialog";
import { WeatherPreferencesProvider } from "./contexts/WeatherPreferencesContext";
import { UnitPreferencesProvider } from "./contexts/UnitPreferencesContext";
import CloudSyncRuntime from "./components/cloud/CloudSyncRuntime";

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
        <BalloonAuthProvider><Suspense fallback={null}><CloudSyncRuntime /></Suspense><UnitPreferencesProvider><WeatherPreferencesProvider><FlightRuntimeProvider><GpsStatsDiagnosticRunner />{children}</FlightRuntimeProvider></WeatherPreferencesProvider></UnitPreferencesProvider><LocalDataMigrationDialog /></BalloonAuthProvider>
      </body>
    </html>
  );
}
