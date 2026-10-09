import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "TOEIC AI Listening — Real-time Listening Assistant",
  description:
    "AI-powered TOEIC Listening practice tool. Continuously listens to TOEIC audio, detects questions, and provides instant answers with explanations in English and Vietnamese.",
  keywords: ["TOEIC", "listening", "AI", "practice", "English", "test prep"],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${inter.variable} dark h-full antialiased`}>
      <body className="min-h-full flex flex-col font-sans bg-zinc-950 text-white">
        {children}
      </body>
    </html>
  );
}
