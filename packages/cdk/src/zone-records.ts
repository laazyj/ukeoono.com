import { type RecordSpec } from "@composurecdk/route53/zone";

/**
 * Canonical record list for the zone. Empty for now — apex/www ALIAS records
 * to the CloudFront distribution are added in system.ts. Add mail (MX/TXT/SPF),
 * DKIM (CNAME), and any domain-verification (TXT) records here when email and
 * search-console are set up for uke-o-ono.com.
 */
export const ZONE_RECORDS: readonly RecordSpec[] = [];
