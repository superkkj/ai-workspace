import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "열어줘 | 하고 싶은 일이 모이는 곳",
  description: "하고 싶은 활동과 원하는 조건을 올려보세요. 이웃과 함께 수요를 모으고 공방·강사의 제안을 받아요.",
  icons: {
    icon: "/brand.svg",
    shortcut: "/brand.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body className="antialiased">{children}</body>
    </html>
  );
}
