import type { Metadata } from 'next';
import { OnboardingFlow } from './onboarding-flow';

export const metadata: Metadata = {
  title: 'Create your first plan · LifeOS',
  description: 'Turn one weekly focus into a believable Today plan.',
};

export default function OnboardingPage() {
  return <OnboardingFlow />;
}
