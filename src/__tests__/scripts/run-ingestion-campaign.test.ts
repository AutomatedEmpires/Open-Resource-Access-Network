import { describe, expect, it } from 'vitest';

import {
  extractExpandableLinks,
} from '../../../scripts/run-ingestion-campaign';

describe('run-ingestion-campaign helpers', () => {
  it('extracts same-host service-like links from allowlisted entry pages', () => {
    const html = `
      <html>
        <body>
          <a href="/benefits/housing-help">Housing Help</a>
          <a href="/programs/food-assistance">Food Assistance Program</a>
          <a href="/privacy">Privacy</a>
          <a href="https://external.example.org/service">External</a>
        </body>
      </html>
    `;

    expect(extractExpandableLinks(html, 'https://www.usa.gov/benefits', 10)).toEqual([
      'https://www.usa.gov/benefits/housing-help',
      'https://www.usa.gov/programs/food-assistance',
    ]);
  });

  it('keeps high-confidence classified links even when the URL is not obviously service-shaped', () => {
    const html = `
      <html>
        <body>
          <a href="/apply-now">Apply Now</a>
          <a href="/eligibility">Who We Serve</a>
          <a href="/contact">Contact Us</a>
        </body>
      </html>
    `;

    expect(extractExpandableLinks(html, 'https://agency.gov/root', 5)).toEqual([
      'https://agency.gov/apply-now',
      'https://agency.gov/eligibility',
      'https://agency.gov/contact',
    ]);
  });
});
