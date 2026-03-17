import { CONFIDENCE_BANDS } from '@/domain/constants';
import type { SeekerPlanServiceSnapshot } from '@/domain/execution';
import type { ConfidenceBand, EnrichedService } from '@/domain/types';
import type { ServiceCard as ChatServiceCardType } from '@/services/chat/types';

function getConfidenceBand(score?: number | null): ConfidenceBand | null {
  if (score == null) return null;
  if (score >= CONFIDENCE_BANDS.HIGH.min) return 'HIGH';
  if (score >= CONFIDENCE_BANDS.LIKELY.min) return 'LIKELY';
  return 'POSSIBLE';
}

function formatAddress(service: EnrichedService): string | null {
  if (!service.address) {
    return null;
  }

  return [
    service.address.address1,
    service.address.city,
    service.address.stateProvince,
    service.address.postalCode,
  ].filter(Boolean).join(', ');
}

export function buildPlanServiceSnapshotFromEnrichedService(
  enriched: EnrichedService,
  detailHref?: string,
): SeekerPlanServiceSnapshot {
  return {
    serviceId: enriched.service.id,
    serviceName: enriched.service.name,
    organizationName: enriched.organization.name,
    detailHref,
    address: formatAddress(enriched),
    trustBand: getConfidenceBand(enriched.confidenceScore?.verificationConfidence),
    capturedAt: new Date().toISOString(),
  };
}

export function buildPlanServiceSnapshotFromChatCard(
  card: ChatServiceCardType,
  detailHref?: string,
): SeekerPlanServiceSnapshot {
  return {
    serviceId: card.serviceId,
    serviceName: card.serviceName,
    organizationName: card.organizationName,
    detailHref,
    address: card.address ?? null,
    trustBand: card.confidenceBand,
    capturedAt: new Date().toISOString(),
  };
}
