import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Serie A Intelligence',
    short_name: 'Serie A Intel',
    description: 'Dashboard privata di analisi Serie A',
    start_url: '/login',
    display: 'standalone',
    background_color: '#0A0F0C',
    theme_color: '#0A0F0C',
    icons: [
      { src: '/icon', sizes: '32x32', type: 'image/png' },
    ],
  }
}
