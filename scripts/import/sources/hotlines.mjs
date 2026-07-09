#!/usr/bin/env node
/**
 * National crisis & benefits hotlines — hand-curated, each VERIFIED against the
 * operator/agency's official site (July 2026). Public-fact phone numbers; several
 * are federal public-domain works (988, VA, SAMHSA, HRSA). These are virtual,
 * nationwide services with NO street address — they seed the crisis/directory
 * surface (not the map). Every number is real; nothing here is model-invented.
 *
 * Usage: node scripts/import/sources/hotlines.mjs > /tmp/hotlines.ndjson
 */
import { writeSync } from 'node:fs';

const H = [
  { id: '988', org: '988 Suicide & Crisis Lifeline', svc: '988 Suicide & Crisis Lifeline', url: 'https://988lifeline.org',
    desc: 'Free, confidential 24/7 support for people in suicidal crisis or emotional distress. Call or text 988. Press 1 for the Veterans Crisis Line; Spanish and LGBTQ+ youth options available.', phones: [['988', 'voice'], ['988', 'sms']] },
  { id: 'vcl', org: 'U.S. Department of Veterans Affairs', svc: 'Veterans Crisis Line', url: 'https://www.veteranscrisisline.net',
    desc: 'Free, confidential 24/7 crisis support for Veterans and their families. Dial 988 then press 1, or text 838255.', phones: [['988', 'voice'], ['838255', 'sms']] },
  { id: 'samhsa', org: 'SAMHSA (Substance Abuse and Mental Health Services Administration)', svc: 'SAMHSA National Helpline', url: 'https://www.samhsa.gov/find-help/national-helpline',
    desc: 'Free, confidential 24/7 treatment referral and information for mental health and substance use disorders. 1-800-662-4357 (TTY 1-800-487-4889).', phones: [['1-800-662-4357', 'voice'], ['1-800-487-4889', 'tty']] },
  { id: 'ndvh', org: 'National Domestic Violence Hotline', svc: 'National Domestic Violence Hotline', url: 'https://www.thehotline.org',
    desc: 'Free, confidential 24/7 support for anyone affected by domestic violence. Call 1-800-799-7233, text START to 88788, or chat online. TTY 1-800-787-3224.', phones: [['1-800-799-7233', 'voice'], ['88788', 'sms'], ['1-800-787-3224', 'tty']] },
  { id: 'nhth', org: 'Polaris Project', svc: 'National Human Trafficking Hotline', url: 'https://humantraffickinghotline.org',
    desc: 'Free, confidential 24/7 help and referrals for victims and survivors of human trafficking. Call 1-888-373-7888 or text 233733.', phones: [['1-888-373-7888', 'voice'], ['233733', 'sms']] },
  { id: 'rainn', org: 'RAINN (Rape, Abuse & Incest National Network)', svc: 'National Sexual Assault Hotline', url: 'https://www.rainn.org',
    desc: 'Free, confidential 24/7 support for survivors of sexual assault. Call 1-800-656-4673 or chat at rainn.org.', phones: [['1-800-656-4673', 'voice']] },
  { id: 'childhelp', org: 'Childhelp', svc: 'Childhelp National Child Abuse Hotline', url: 'https://www.childhelphotline.org',
    desc: 'Free, confidential 24/7 support for child abuse concerns, for children and adults. Call or text 1-800-422-4453.', phones: [['1-800-422-4453', 'voice'], ['1-800-422-4453', 'sms']] },
  { id: 'nrs', org: 'National Runaway Safeline', svc: 'National Runaway Safeline', url: 'https://www.1800runaway.org',
    desc: 'Free, confidential 24/7 crisis support for runaway and homeless youth and their families. Call 1-800-786-2929.', phones: [['1-800-786-2929', 'voice']] },
  { id: 'ddh', org: 'SAMHSA Disaster Distress Helpline', svc: 'Disaster Distress Helpline', url: 'https://www.samhsa.gov/find-help/disaster-distress-helpline',
    desc: 'Free, confidential 24/7 crisis counseling for people experiencing emotional distress related to natural or human-caused disasters. Call or text 1-800-985-5990.', phones: [['1-800-985-5990', 'voice'], ['1-800-985-5990', 'sms']] },
  { id: 'nmmh', org: 'HRSA National Maternal Mental Health Hotline', svc: 'National Maternal Mental Health Hotline', url: 'https://mchb.hrsa.gov/national-maternal-mental-health-hotline',
    desc: 'Free, confidential 24/7 support before, during, and after pregnancy. Call or text 1-833-852-6262 (TLC-MAMA).', phones: [['1-833-852-6262', 'voice'], ['1-833-852-6262', 'sms']] },
  { id: 'ctl', org: 'Crisis Text Line', svc: 'Crisis Text Line', url: 'https://www.crisistextline.org',
    desc: 'Free, confidential 24/7 crisis support by text. Text HOME to 741741.', phones: [['741741', 'sms']] },
  { id: 'trevor', org: 'The Trevor Project', svc: 'Trevor Lifeline (LGBTQ+ youth)', url: 'https://www.thetrevorproject.org/get-help',
    desc: 'Free, confidential 24/7 crisis support for LGBTQ+ young people. Call 1-866-488-7386 or text START to 678678.', phones: [['1-866-488-7386', 'voice'], ['678678', 'sms']] },
  { id: 'translifeline', org: 'Trans Lifeline', svc: 'Trans Lifeline', url: 'https://translifeline.org',
    desc: 'Peer support hotline run by and for trans people. Call 1-877-565-8860.', phones: [['1-877-565-8860', 'voice']] },
];

let out = '';
for (const h of H) {
  out += JSON.stringify({
    source: 'hotline', sourceId: h.id, authorityClass: 'crisis',
    org: { name: h.org, key: h.id, url: h.url },
    service: { name: h.svc, description: h.desc, url: h.url, category: 'hotline' },
    phones: h.phones.map(([number, type]) => ({ number, type })),
    verification: 85,
  }) + '\n';
}
writeSync(1, out);
console.error(`Hotlines: ${H.length} national hotlines emitted.`);
