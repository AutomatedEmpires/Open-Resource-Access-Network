import type { MetadataRoute } from 'next';
import { SITE } from '@/lib/site';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: SITE.legalName,
    short_name: SITE.acronym,
    description: SITE.description,
    start_url: '/',
    display: 'standalone',
    background_color: '#f7f7f5',
    theme_color: '#111111',
    categories: ['government', 'health', 'utilities', 'productivity'],
    icons: [
      {
        src: '/globe.svg',
        sizes: 'any',
        type: 'image/svg+xml',
        purpose: 'any',
      },
    ],
  };
}
