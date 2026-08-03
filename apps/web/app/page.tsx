import { TodayClient } from './today-client';

export default function TodayPage() {
  return <TodayClient generatedAt={new Date().toISOString()} />;
}
