# Search Discovery Runbook

This document covers the work required to strengthen branded discovery for ORAN in Google, Bing, AI answer engines, partner citations, and trust review workflows.

## Scope

The repository now provides:

- Canonical metadata using the ORAN and Open Resource Access Network names consistently.
- Expanded `sitemap.xml` coverage for public trust and identity pages.
- `robots.txt` for crawler guidance.
- `manifest.webmanifest` for entity consistency across browsers and devices.
- `/.well-known/security.txt` for standard security-contact discovery.
- Public trust surfaces: `/about`, `/about/press`, `/about/team`, `/trust`, `/status`, `/security`, `/privacy`.

These changes help search engines understand the site. They do not, by themselves, guarantee a top ranking for the bare query `ORAN`.

## Ranking Reality

`ORAN` is a short acronym and will compete with other established entities, including O-RAN related results. The practical objective is:

1. Own `Open Resource Access Network`.
2. Own `ORAN Open Resource Access Network`.
3. Increase the probability that `ORAN` resolves to this project as branded signals accumulate.

## Google Setup

1. Verify the domain in Google Search Console using DNS TXT if possible.
2. If DNS verification is not available, set `NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION` in the production environment and redeploy.
3. Submit `https://openresourceaccessnetwork.com/sitemap.xml` in Search Console.
4. Inspect and request indexing for:
   - `/`
   - `/about`
   - `/trust`
   - `/about/press`
   - `/status`
5. Monitor Coverage, Page Indexing, and Search Results for brand queries.

## Bing Setup

1. Verify the domain in Bing Webmaster Tools.
2. If Bing provides a meta verification token, set `NEXT_PUBLIC_BING_SITE_VERIFICATION` in production and redeploy.
3. Submit the same sitemap.
4. Import from Google Search Console if that reduces setup friction.

## Optional Verification Variables

Set these in the production environment only:

```bash
NEXT_PUBLIC_SITE_URL=https://openresourceaccessnetwork.com
NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION=...
NEXT_PUBLIC_BING_SITE_VERIFICATION=...
NEXT_PUBLIC_YANDEX_SITE_VERIFICATION=...
NEXT_PUBLIC_ORAN_SAME_AS=https://www.linkedin.com/company/...,https://x.com/...,https://www.crunchbase.com/organization/...
```

Only include `NEXT_PUBLIC_ORAN_SAME_AS` URLs that are real, public, and organization-controlled.

## Backlink Priorities

High-value backlinks should come from relevant, trustworthy domains. Prioritize:

1. Partner nonprofits linking to ORAN from their resource or technology pages.
2. Government or civic partners linking from `.gov` and program pages where appropriate.
3. University, library, and public-health directories.
4. Press coverage from independent publications.
5. Conference, hackathon, accelerator, and civic-tech showcase pages.
6. Open-source profiles that reference the canonical domain, not only the GitHub repo.

Anchor text should alternate naturally between:

- `ORAN`
- `Open Resource Access Network`
- `ORAN (Open Resource Access Network)`
- descriptive phrases such as `verified community services directory`

Do not mass-produce low-quality backlinks, directory spam, or purchased links.

## Trust Profiles And References

Create and maintain factual profiles on platforms that fit the project's actual footprint:

1. GitHub organization or repository profile with the canonical domain.
2. LinkedIn company page.
3. Crunchbase only if the project actually qualifies and the facts can be supported.
4. Product Hunt only if there is a real launch.
5. Relevant nonprofit, civic-tech, and digital-public-infrastructure directories.

Every profile should use the exact same naming pattern:

- `ORAN`
- `Open Resource Access Network`
- `https://openresourceaccessnetwork.com`

## Wikipedia And Wikidata

Do not create a promotional Wikipedia page directly from an ORAN-controlled account.

Use this sequence instead:

1. Earn multiple independent, reliable secondary sources first.
2. Create or improve a neutral Wikidata item only with verifiable facts.
3. If ORAN becomes independently notable, propose a neutral Wikipedia draft through the standard Articles for Creation workflow and disclose the conflict of interest.

Without independent sourcing, a self-authored Wikipedia article is likely to be deleted and can damage trust signals.

## Content Refresh Cadence

Review monthly:

1. `/about` for mission and vision accuracy.
2. `/about/press` for updated fact sheet and media references.
3. `/trust` for any new public trust surfaces.
4. `/status` and `/changelog` so they remain credible.
5. `robots.txt`, `sitemap.xml`, and Search Console reports.

## Success Metrics

Track these instead of only raw rank position:

1. Indexed branded pages count.
2. Search Console impressions and clicks for `ORAN` and `Open Resource Access Network`.
3. Number of referring domains.
4. Number of partner domains using the full brand name.
5. Press mentions from independent sources.
6. Whether Google surfaces sitelinks for `/about`, `/trust`, and `/contact`.

## Anti-Patterns

Avoid:

1. Claiming ORAN is the top result before it is measurable.
2. Publishing unverifiable founding, usage, or partnership claims.
3. Creating fake reviews, fake press, or synthetic backlinks.
4. Stuffing `ORAN` unnaturally into titles and copy.
5. Letting external profiles drift away from the canonical name and URL.
