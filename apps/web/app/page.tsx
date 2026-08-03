import { FirstRunRedirect } from './onboarding/first-run-redirect';
import { TodayClient } from './today-client';

export default function TodayPage() {
  return (
    <>
      <FirstRunRedirect />
      <TodayClient generatedAt={new Date().toISOString()} />
    </>
  );
}
