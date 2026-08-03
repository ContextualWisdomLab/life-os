import { OnboardingFlow } from './onboarding-flow';

/** Renders the bounded first-run experience for a new local workspace. */
export default function OnboardingPage() {
  return <OnboardingFlow generatedAt={new Date().toISOString()} />;
}
