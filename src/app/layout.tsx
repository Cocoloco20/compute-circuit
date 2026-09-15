import type { Metadata } from 'next'
import localFont from 'next/font/local'
import './globals.css'

const geistSans = localFont({
  src: './fonts/GeistVF.woff',
  variable: '--font-geist-sans',
  weight: '100 900',
})
const geistMono = localFont({
  src: './fonts/GeistMonoVF.woff',
  variable: '--font-geist-mono',
  weight: '100 900',
})

const description = 'Offtake — the ledger of disclosed AI compute, colocation, hosting and power contracts, read from SEC filings with the source excerpt on every row.'

export const metadata: Metadata = {
  metadataBase: new URL('https://offtake-ledger.vercel.app'),
  title: 'Offtake',
  description,
  openGraph: {
    title: 'Offtake',
    description,
    url: 'https://offtake-ledger.vercel.app',
    siteName: 'Offtake',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Offtake',
    description,
  },
}

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="dark">
      <body className={`${geistSans.variable} ${geistMono.variable} bg-[#05060a] text-zinc-200 antialiased`}>
        {children}
      </body>
    </html>
  )
}
