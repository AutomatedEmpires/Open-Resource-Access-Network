import type { PoolClient } from 'pg';

import type { RegressionCandidate } from './detector';

export interface RegressionPolicySummary {
  suppressedCount: number;
  suppressedServiceIds: string[];
}

export function shouldSuppressService(candidate: RegressionCandidate): boolean {
  return candidate.recommendedAction === 'suppress';
}

export async function applyRegressionVisibilityPolicies(
  client: PoolClient,
  candidates: RegressionCandidate[],
): Promise<RegressionPolicySummary> {
  const serviceIds = Array.from(
    new Set(
      candidates
        .filter(shouldSuppressService)
        .map((candidate) => candidate.serviceId),
    ),
  );

  if (serviceIds.length === 0) {
    return {
      suppressedCount: 0,
      suppressedServiceIds: [],
    };
  }

  const result = await client.query<{ id: string }>(
    `UPDATE services
     SET status = 'inactive',
         updated_at = NOW()
     WHERE id = ANY($1::uuid[])
       AND status = 'active'
     RETURNING id`,
    [serviceIds],
  );

  return {
    suppressedCount: result.rows.length,
    suppressedServiceIds: result.rows.map((row) => row.id),
  };
}
