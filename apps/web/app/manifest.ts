import type { MetadataRoute } from 'next';

/** Returns the stable install metadata for the LifeOS browser application. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'LifeOS',
    short_name: 'LifeOS',
    description:
      'A local-first workspace for goals, projects, tasks, habits, and reviews.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#f3f4ef',
    theme_color: '#17382c',
    orientation: 'any',
    lang: 'en',
    icons: [
      {
        src: '/icons/life-os.svg',
        sizes: 'any',
        type: 'image/svg+xml',
        purpose: 'any',
      },
      {
        src: '/icons/life-os.svg',
        sizes: 'any',
        type: 'image/svg+xml',
        purpose: 'maskable',
      },
    ],
  };
}
