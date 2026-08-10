import type { TrustedCalendarUserContext } from './calendar-service-context';
import type {
  CalendarConnectionRevocationRecord,
  RevokeCalendarConnection,
} from './calendar-connection-revocation';

/** Least-authority persistence port required to disconnect one calendar connection. */
export interface CalendarConnectionRevocationPort {
  revokeConnection(
    input: RevokeCalendarConnection,
  ): Promise<CalendarConnectionRevocationRecord | undefined>;
}

/** Public credential-free result returned after a successful local disconnect. */
export interface CalendarConnectionDisconnectResult {
  readonly connectionId: string;
  readonly status: 'revoked';
  readonly revokedAt: string;
}

/** Application boundary for an authenticated user disconnecting one owned connection. */
export class CalendarConnectionDisconnectApplication {
  /** Creates the application over a tenant/user-scoped revocation port. */
  constructor(
    private readonly revocations: CalendarConnectionRevocationPort,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Disconnects one owned connection without returning provider credential material. */
  async disconnect(
    _authority: TrustedCalendarUserContext,
    _connectionId: string,
  ): Promise<CalendarConnectionDisconnectResult | undefined> {
    throw new Error('calendar connection disconnect is not implemented');
  }
}
