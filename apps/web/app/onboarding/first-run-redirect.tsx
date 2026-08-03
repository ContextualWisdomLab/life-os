'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  ONBOARDING_STORAGE_KEY,
  parseStoredOnboardingCompletion,
  TODAY_STORAGE_KEY,
} from './onboarding-state';
import { parseStoredTodayDraft } from '../today-storage';

function localDate(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export function FirstRunRedirect() {
  const router = useRouter();

  useEffect(() => {
    try {
      const completion = parseStoredOnboardingCompletion(
        window.localStorage.getItem(ONBOARDING_STORAGE_KEY),
      );
      if (completion) {
        return;
      }
      const draft = parseStoredTodayDraft(
        window.localStorage.getItem(TODAY_STORAGE_KEY),
        localDate(),
      );
      if (draft.actions.length === 0) {
        router.replace('/onboarding');
      }
    } catch {
      // Storage-denied browsers remain on the usable local Today surface.
    }
  }, [router]);

  return null;
}
