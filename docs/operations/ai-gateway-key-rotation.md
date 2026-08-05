# AI gateway HMAC key rotation runbook

This runbook rotates the private web-gateway-to-AI-service context credential without rejecting valid in-flight requests. It applies after both workloads support the version 2 keyed context contract.

## Configuration contract

| Role     | Identifier                   | Secret                           | Sign | Verify |
| -------- | ---------------------------- | -------------------------------- | ---- | ------ |
| Active   | `AI_GATEWAY_ACTIVE_KEY_ID`   | `AI_GATEWAY_ACTIVE_KEY_SECRET`   | Yes  | Yes    |
| Previous | `AI_GATEWAY_PREVIOUS_KEY_ID` | `AI_GATEWAY_PREVIOUS_KEY_SECRET` | No   | Yes    |

The active pair is mandatory. The previous pair is optional but must be configured completely. Identifiers are case-sensitive and must be distinct. Secrets must be independently generated and delivered through the platform secret manager; never place them in Git, container images, command history, tickets, chat, or logs.

## Planned rotation

Assume `key-a` is active and `key-b` is newly generated.

### 1. Prepare

1. Generate `key-b` with a cryptographically secure random generator and at least 32 bytes of entropy.
2. Create a non-secret opaque identifier for `key-b`.
3. Record owner, environment, purpose, creation time, planned activation time, and planned retirement time in the secret inventory.
4. Confirm the maximum accepted context age and future-clock skew. The overlap must remain longer than the full request-validity window plus deployment propagation and rollback allowance.

### 2. Expand verifier configuration

Deploy the AI service with:

- active: `key-a`
- previous: `key-b`

At this stage the web gateway still signs with `key-a`. The AI service can verify either explicit identifier, but normal traffic continues to use `key-a`. Confirm health, invalid-identifier rejection, and no secret-bearing logs.

### 3. Switch the signer

Deploy the web gateway with:

- active: `key-b`

Deploy the AI service with:

- active: `key-b`
- previous: `key-a`

The gateway now creates only `key-b` signatures. The AI service still accepts valid in-flight `key-a` contexts during the bounded overlap. Monitor authentication failure rate, key-identifier distribution, clock skew, and deployment health without logging signatures or secret values.

### 4. Retire the previous key

After the maximum context lifetime, skew allowance, deployment propagation, and rollback window have elapsed:

1. Remove the previous pair from the AI service configuration.
2. Verify that requests explicitly identifying `key-a` fail with `invalid_gateway_context`.
3. Revoke or destroy `key-a` in the secret manager according to retention policy.
4. Update the inventory with retirement and destruction evidence.

## Emergency revocation

When compromise is suspected, do not retain the compromised key as previous.

1. Generate and distribute a new active key.
2. Deploy the verifier and signer as a coordinated emergency change.
3. Remove the compromised key immediately from every verifier.
4. Investigate all use of the compromised identifier using metadata-only telemetry.
5. Preserve incident evidence without recording key material or complete signatures.

Emergency revocation may reject in-flight requests signed by the compromised key. Security takes precedence over availability in this case.

## Rollback

During a planned overlap, rollback the signer by restoring the previous key as active while both keys remain configured on the AI service. Do not create two active signers with different keys behind the same deployment unless the AI service retains both explicit identifiers for the entire rollout.

## Validation checklist

- Active and previous identifiers are distinct.
- Previous identifier and secret are both present or both absent.
- The web gateway signs only with the active key.
- The AI service selects exactly one key by identifier and does not trial multiple secrets.
- Missing, malformed, unknown, and retired identifiers fail closed.
- Method, path, workspace, actor, issuance time, and key identifier are all integrity-protected.
- Logs and problem responses contain no secrets, signatures, or untrusted identifier values.
- Unit, controller, BFF, integration, configuration, replay, and rotation tests pass.
- AI-service statement, branch, function, and line coverage remain at 100%.
