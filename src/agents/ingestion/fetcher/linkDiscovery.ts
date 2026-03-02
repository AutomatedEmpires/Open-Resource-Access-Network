import * as cheerio from 'cheerio';

import {
  type DiscoveredLinkResult,
  type LinkDiscoveryOptions,
  LinkDiscoveryOptionsSchema,
  type LinkType,
} from './types';

/**
 * Link classification patterns for identifying relevant links.
 */
interface LinkPattern {
  type: LinkType;
  urlPatterns: RegExp[];
  textPatterns: RegExp[];
  confidence: number;
}

const LINK_PATTERNS: LinkPattern[] = [
  {
    type: 'contact',
    urlPatterns: [/contact/i, /reach-us/i, /get-in-touch/i, /connect/i],
    textPatterns: [/contact\s*us/i, /get\s*in\s*touch/i, /reach\s*out/i, /connect\s*with\s*us/i],
    confidence: 0.9,
  },
  {
    type: 'apply',
    urlPatterns: [/apply/i, /application/i, /enroll/i, /register/i, /sign-?up/i, /intake/i],
    textPatterns: [
      /apply(\s+now)?/i,
      /application/i,
      /enroll/i,
      /register/i,
      /sign\s*up/i,
      /get\s*started/i,
      /intake/i,
    ],
    confidence: 0.9,
  },
  {
    type: 'eligibility',
    urlPatterns: [/eligib/i, /qualif/i, /requirements?/i, /criteria/i, /who-we-serve/i],
    textPatterns: [
      /eligib/i,
      /qualif/i,
      /requirements?/i,
      /who\s*(we\s*)?serve/i,
      /who\s*can\s*(apply|use)/i,
      /criteria/i,
    ],
    confidence: 0.85,
  },
  {
    type: 'intake_form',
    urlPatterns: [/intake/i, /form/i, /questionnaire/i, /assessment/i, /screening/i],
    textPatterns: [/intake\s*form/i, /questionnaire/i, /assessment/i, /screening/i, /referral\s*form/i],
    confidence: 0.8,
  },
  {
    type: 'hours',
    urlPatterns: [/hours/i, /schedule/i, /when-we/i, /location/i, /visit/i],
    textPatterns: [
      /(business\s*)?hours/i,
      /when\s*(we('re)?\s*)?(open|available)/i,
      /schedule/i,
      /find\s*us/i,
      /visit\s*us/i,
    ],
    confidence: 0.75,
  },
  {
    type: 'pdf',
    urlPatterns: [/\.pdf$/i],
    textPatterns: [/download/i, /pdf/i, /brochure/i, /flyer/i, /handout/i],
    confidence: 0.95,
  },
  {
    type: 'privacy',
    urlPatterns: [/privacy/i, /terms/i, /legal/i],
    textPatterns: [/privacy\s*policy/i, /terms\s*(of\s*(use|service))?/i, /legal/i],
    confidence: 0.9,
  },
  {
    type: 'home',
    urlPatterns: [/^\/?$/, /home/i, /index\.(html?|php|aspx?)$/i],
    textPatterns: [/^home$/i, /main\s*page/i],
    confidence: 0.7,
  },
];

/**
 * LinkDiscovery scans HTML content to find and classify relevant links.
 * It identifies links for contact info, applications, eligibility, hours, etc.
 */
export class LinkDiscovery {
  private readonly options: LinkDiscoveryOptions;

  constructor(options: Partial<LinkDiscoveryOptions> = {}) {
    this.options = LinkDiscoveryOptionsSchema.parse(options);
  }

  /**
   * Discover and classify links in HTML content.
   */
  discover(html: string, baseUrl: string): DiscoveredLinkResult[] {
    const $ = cheerio.load(html);
    const links: DiscoveredLinkResult[] = [];
    const seenUrls = new Set<string>();

    const baseDomain = this.extractDomain(baseUrl);

    $('a[href]').each((_, element) => {
      const $el = $(element);
      const href = $el.attr('href');
      if (!href) return;

      // Skip anchors and javascript
      if (href.startsWith('#') || href.startsWith('javascript:') || href.startsWith('mailto:')) {
        return;
      }

      // Resolve relative URLs
      let resolvedUrl: string;
      try {
        resolvedUrl = this.options.resolveRelative ? new URL(href, baseUrl).href : href;
      } catch {
        return; // Skip invalid URLs
      }

      // Check if external
      const linkDomain = this.extractDomain(resolvedUrl);
      const isExternal = linkDomain !== baseDomain;
      if (isExternal && !this.options.includeExternal) {
        return;
      }

      // Skip duplicates
      const normalizedUrl = this.normalizeUrl(resolvedUrl);
      if (seenUrls.has(normalizedUrl)) {
        return;
      }
      seenUrls.add(normalizedUrl);

      // Get link context
      const linkText = $el.text().trim();
      const title = $el.attr('title')?.trim();
      const ariaLabel = $el.attr('aria-label')?.trim();

      // Classify the link
      const classification = this.classifyLink(resolvedUrl, linkText, title, ariaLabel);
      if (classification.confidence >= this.options.minConfidence) {
        links.push({
          url: resolvedUrl,
          type: classification.type,
          label: linkText || title || ariaLabel,
          confidence: classification.confidence,
          context: title || ariaLabel,
        });
      }
    });

    // Sort by confidence and limit
    return links.sort((a, b) => b.confidence - a.confidence).slice(0, this.options.maxLinks);
  }

  /**
   * Classify a link based on URL and text patterns.
   */
  private classifyLink(
    url: string,
    text: string,
    title?: string,
    ariaLabel?: string
  ): { type: LinkType; confidence: number } {
    const combinedText = [text, title, ariaLabel].filter(Boolean).join(' ');

    let bestMatch: { type: LinkType; confidence: number } = { type: 'other', confidence: 0.3 };

    for (const pattern of LINK_PATTERNS) {
      let confidence = 0;

      // Check URL patterns
      for (const urlPattern of pattern.urlPatterns) {
        if (urlPattern.test(url)) {
          confidence = Math.max(confidence, pattern.confidence);
          break;
        }
      }

      // Check text patterns (boost confidence if both match)
      for (const textPattern of pattern.textPatterns) {
        if (textPattern.test(combinedText)) {
          confidence = confidence > 0 ? Math.min(confidence + 0.1, 1.0) : pattern.confidence * 0.9;
          break;
        }
      }

      if (confidence > bestMatch.confidence) {
        bestMatch = { type: pattern.type, confidence };
      }
    }

    return bestMatch;
  }

  /**
   * Extract domain from URL for comparison.
   */
  private extractDomain(url: string): string {
    try {
      const parsed = new URL(url);
      return parsed.hostname.toLowerCase().replace(/^www\./, '');
    } catch {
      return '';
    }
  }

  /**
   * Normalize URL for deduplication.
   */
  private normalizeUrl(url: string): string {
    try {
      const parsed = new URL(url);
      // Remove trailing slash, lowercase hostname
      let normalized = `${parsed.protocol}//${parsed.hostname.toLowerCase()}${parsed.pathname.replace(/\/$/, '')}`;
      if (parsed.search) {
        normalized += parsed.search;
      }
      return normalized;
    } catch {
      return url.toLowerCase();
    }
  }
}

/**
 * Factory function to create a LinkDiscovery instance.
 */
export function createLinkDiscovery(options: Partial<LinkDiscoveryOptions> = {}): LinkDiscovery {
  return new LinkDiscovery(options);
}

/**
 * Convenience function to discover links in one call.
 */
export function discoverLinks(
  html: string,
  baseUrl: string,
  options: Partial<LinkDiscoveryOptions> = {}
): DiscoveredLinkResult[] {
  return new LinkDiscovery(options).discover(html, baseUrl);
}
