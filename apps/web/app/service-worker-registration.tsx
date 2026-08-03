'use client';

import { useEffect } from 'react';

const SERVICE_WORKER_PATH = '/sw.js';

/** Registers the same-origin LifeOS service worker without blocking rendering. */
export function ServiceWorkerRegistration(): null {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) {
      document.documentElement.dataset.serviceWorker = 'unsupported';
      return;
    }

    let cancelled = false;
    async function registerServiceWorker(): Promise<void> {
      try {
        const registration = await navigator.serviceWorker.register(
          SERVICE_WORKER_PATH,
          {
            scope: '/',
            updateViaCache: 'none',
          },
        );
        await navigator.serviceWorker.ready;
        if (!cancelled) {
          document.documentElement.dataset.serviceWorker = 'registered';
        }
        void registration.update().catch(() => undefined);
      } catch {
        if (!cancelled) {
          document.documentElement.dataset.serviceWorker = 'unavailable';
        }
      }
    }

    void registerServiceWorker();
    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}
