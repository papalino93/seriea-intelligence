import type { Metadata, Viewport } from 'next'
import { Space_Grotesk, Inter, IBM_Plex_Mono } from 'next/font/google'
import './globals.css'

const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  variable: '--font-display',
  weight: ['500', '700'],
})
const inter = Inter({ subsets: ['latin'], variable: '--font-body' })
const plexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  weight: ['400', '500'],
})

export const metadata: Metadata = {
  metadataBase: new URL('https://seriea-intelligence.vercel.app'),
  title: 'Serie A Intelligence',
  description: 'Dashboard privata di analisi Serie A',
  appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: 'Serie A Intel' },
}

export const viewport: Viewport = {
  themeColor: '#0A0F0C',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="it" className={`${spaceGrotesk.variable} ${inter.variable} ${plexMono.variable}`}>
      <body className="font-body">{children}</body>
    </html>
  )
}
