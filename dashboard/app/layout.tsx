import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'RBLX Dashboard',
  description: 'Roblox playtime analytics dashboard',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
