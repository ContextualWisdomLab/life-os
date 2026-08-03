'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  ONBOARDING_COMPLETION_STORAGE_KEY,
  ONBOARDING_DISMISSAL_STORAGE_KEY,
  shouldEnterOnboarding,
  TODAY_STORAGE_KEY,
} from './onboarding-entry';

function localDate(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/** Directs only a genuinely empty, storage-capable browser into onboarding. */
export function FirstRunRedirect() {
  const router = useRouter();

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('onboarding') === 'skip') {
      return;
    }
    try {
      if (
        shouldEnterOnboarding({
          todaySerialized: window.localStorage.getItem(TODAY_STORAGE_KEY),
          completionSerialized: window.localStorage.getItem(
            ONBOARDING_COMPLETION_STORAGE_KEY,
          ),
          dismissalSerialized: window.localStorage.getItem(
            ONBOARDING_DISMISSAL_STORAGE_KEY,
          ),
          date: localDate(),
        })
      ) {
        router.replace('/onboarding');
      }
    } catch {
      // Storage-denied browsers retain the usable Today surface.
    }
  }, [router]);

  return null;
}
