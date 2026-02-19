import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MiniGames Hub",
  description: "2D 캐주얼 미니게임 허브"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
