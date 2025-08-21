import type { Metadata } from "next";

import "./globals.css";



export const metadata: Metadata = {
  title: "LocalShare - Secure File Sharing",
  description: "Share files locally and securely within your network",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        // className=`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
