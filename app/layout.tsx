import type { Metadata } from "next";
import Script from "next/script";
import { Toaster } from "sonner";

import "./globals.css";

export const metadata: Metadata = {
  title: "Market-Vantage | Likewize",
  description: "Market Vantage — sentiment and competitor intelligence for device protection.",
  icons: {
    icon: "/favicon.ico",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="antialiased" suppressHydrationWarning>
      <body className="min-h-screen bg-[var(--background)] text-[var(--foreground)] font-sans">
        <Script id="mv-embed-detect" strategy="beforeInteractive">
          {`(function(){try{if(window.self!==window.top)document.documentElement.classList.add('mv-embedded')}catch(e){document.documentElement.classList.add('mv-embedded')}})();`}
        </Script>
        {/* Microsoft Clarity */}
        <Script id="microsoft-clarity" strategy="afterInteractive">
          {`(function(c,l,a,r,i,t,y){
            c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
            t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;
            y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);
          })(window, document, "clarity", "script", "xsmxje2t4c");`}
        </Script>
        {children}
        <Toaster position="top-center" richColors />
      </body>
    </html>
  );
}
