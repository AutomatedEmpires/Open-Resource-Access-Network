import { lookup as dnsLookup } from 'node:dns/promises';
import type { LookupAddress, LookupOptions } from 'node:dns';
import { isIP } from 'node:net';

import { Agent } from 'undici';

export type OutboundHttpPolicyErrorCode =
  | 'invalid_url'
  | 'blocked_scheme'
  | 'blocked_credentials'
  | 'blocked_hostname'
  | 'dns_resolution_failed'
  | 'blocked_address'
  | 'aborted';

export class OutboundHttpPolicyError extends Error {
  readonly code: OutboundHttpPolicyErrorCode;

  constructor(code: OutboundHttpPolicyErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'OutboundHttpPolicyError';
    this.code = code;
  }
}

export interface ResolvedOutboundAddress {
  address: string;
  family: 4 | 6;
}

export type OutboundDnsResolver = (
  hostname: string,
) => Promise<readonly ResolvedOutboundAddress[]>;

export interface ValidatedOutboundHttpTarget {
  url: URL;
  addresses: readonly ResolvedOutboundAddress[];
}

export interface ValidateOutboundHttpUrlOptions {
  resolver?: OutboundDnsResolver;
  signal?: AbortSignal;
}

const BLOCKED_HOST_SUFFIXES = [
  '.home.arpa',
  '.internal',
  '.invalid',
  '.local',
  '.localdomain',
  '.localhost',
  '.test',
  '.example',
  '.lan',
] as const;

const defaultResolver: OutboundDnsResolver = async (hostname) => {
  const answers = await dnsLookup(hostname, { all: true, verbatim: true });
  return answers.flatMap((answer) => {
    if (answer.family !== 4 && answer.family !== 6) return [];
    return [{ address: answer.address, family: answer.family }];
  });
};

function stripIpv6Brackets(hostname: string): string {
  return hostname.startsWith('[') && hostname.endsWith(']')
    ? hostname.slice(1, -1)
    : hostname;
}

function parseIpv4(address: string): number[] | null {
  const parts = address.split('.');
  if (parts.length !== 4) return null;

  const octets = parts.map((part) => Number(part));
  if (
    octets.some(
      (octet, index) =>
        !Number.isInteger(octet) ||
        octet < 0 ||
        octet > 255 ||
        String(octet) !== parts[index],
    )
  ) {
    return null;
  }
  return octets;
}

function ipv4ToHextets(address: string): [string, string] | null {
  const octets = parseIpv4(address);
  if (!octets) return null;
  return [
    ((octets[0] << 8) | octets[1]).toString(16),
    ((octets[2] << 8) | octets[3]).toString(16),
  ];
}

function ipv6ToBigInt(address: string): bigint | null {
  let normalized = stripIpv6Brackets(address).toLowerCase();
  if (normalized.includes('%')) return null;

  const dottedTail = normalized.lastIndexOf(':');
  if (normalized.includes('.')) {
    if (dottedTail < 0) return null;
    const hextets = ipv4ToHextets(normalized.slice(dottedTail + 1));
    if (!hextets) return null;
    normalized = `${normalized.slice(0, dottedTail)}:${hextets[0]}:${hextets[1]}`;
  }

  if ((normalized.match(/::/g) ?? []).length > 1) return null;
  const [leftRaw, rightRaw] = normalized.split('::');
  const left = leftRaw ? leftRaw.split(':') : [];
  const right = rightRaw ? rightRaw.split(':') : [];

  if (normalized.includes('::')) {
    const missing = 8 - left.length - right.length;
    if (missing < 1) return null;
    left.push(...Array<string>(missing).fill('0'));
  }

  const groups = [...left, ...right];
  if (groups.length !== 8 || groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) {
    return null;
  }

  return groups.reduce(
    (value, group) => (value << BigInt(16)) | BigInt(`0x${group}`),
    BigInt(0),
  );
}

function ipv6CidrContains(value: bigint, base: string, prefixLength: number): boolean {
  const baseValue = ipv6ToBigInt(base);
  if (baseValue === null) throw new Error(`Invalid internal IPv6 CIDR base: ${base}`);
  const shift = BigInt(128) - BigInt(prefixLength);
  return value >> shift === baseValue >> shift;
}

function isPublicIpv4(address: string): boolean {
  const octets = parseIpv4(address);
  if (!octets) return false;
  const [a, b, c] = octets;

  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 192 && b === 0 && c === 0) return false;
  if (a === 192 && b === 0 && c === 2) return false;
  if (a === 192 && b === 31 && c === 196) return false;
  if (a === 192 && b === 52 && c === 193) return false;
  if (a === 192 && b === 88 && c === 99) return false;
  if (a === 192 && b === 175 && c === 48) return false;
  if (a === 198 && (b === 18 || b === 19)) return false;
  if (a === 198 && b === 51 && c === 100) return false;
  if (a === 203 && b === 0 && c === 113) return false;

  return true;
}

function isPublicIpv6(address: string): boolean {
  const value = ipv6ToBigInt(address);
  if (value === null) return false;

  const blockedCidrs: ReadonlyArray<readonly [string, number]> = [
    ['::', 96],
    ['::ffff:0:0', 96],
    ['64:ff9b::', 96],
    ['64:ff9b:1::', 48],
    ['100::', 64],
    ['2001::', 23],
    ['2001:db8::', 32],
    ['2002::', 16],
    ['3fff::', 20],
    ['5f00::', 16],
    ['fc00::', 7],
    ['fe80::', 10],
    ['ff00::', 8],
  ];

  return !blockedCidrs.some(([base, prefix]) => ipv6CidrContains(value, base, prefix));
}

export function isPublicOutboundAddress(address: string): boolean {
  const normalized = stripIpv6Brackets(address);
  const family = isIP(normalized);
  if (family === 4) return isPublicIpv4(normalized);
  if (family === 6) return isPublicIpv6(normalized);
  return false;
}

function isBlockedHostname(hostname: string): boolean {
  const normalized = stripIpv6Brackets(hostname).toLowerCase().replace(/\.$/, '');
  if (!normalized || normalized === 'localhost' || normalized === 'internal') return true;
  if (isIP(normalized) === 0 && !normalized.includes('.')) return true;
  return BLOCKED_HOST_SUFFIXES.some(
    (suffix) => normalized === suffix.slice(1) || normalized.endsWith(suffix),
  );
}

export function parseOutboundHttpUrl(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch (cause) {
    throw new OutboundHttpPolicyError('invalid_url', 'Outbound URL is invalid', { cause });
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new OutboundHttpPolicyError(
      'blocked_scheme',
      'Outbound URL must use HTTP or HTTPS',
    );
  }
  if (url.username || url.password) {
    throw new OutboundHttpPolicyError(
      'blocked_credentials',
      'Outbound URL must not contain credentials',
    );
  }
  if (isBlockedHostname(url.hostname)) {
    throw new OutboundHttpPolicyError('blocked_hostname', 'Outbound hostname is not public');
  }

  const literal = stripIpv6Brackets(url.hostname);
  if (isIP(literal) !== 0 && !isPublicOutboundAddress(literal)) {
    throw new OutboundHttpPolicyError('blocked_address', 'Outbound IP address is not public');
  }

  return url;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new OutboundHttpPolicyError('aborted', 'Outbound URL validation was aborted', {
      cause: signal.reason,
    });
  }
}

async function resolveWithSignal(
  resolver: OutboundDnsResolver,
  hostname: string,
  signal: AbortSignal | undefined,
): Promise<readonly ResolvedOutboundAddress[]> {
  throwIfAborted(signal);
  if (!signal) return resolver(hostname);

  return new Promise((resolve, reject) => {
    const onAbort = () => {
      reject(
        new OutboundHttpPolicyError('aborted', 'Outbound URL validation was aborted', {
          cause: signal.reason,
        }),
      );
    };
    signal.addEventListener('abort', onAbort, { once: true });
    resolver(hostname).then(resolve, reject).finally(() => {
      signal.removeEventListener('abort', onAbort);
    });
  });
}

export async function validateOutboundHttpUrl(
  rawUrl: string,
  options: ValidateOutboundHttpUrlOptions = {},
): Promise<ValidatedOutboundHttpTarget> {
  const url = parseOutboundHttpUrl(rawUrl);
  const hostname = stripIpv6Brackets(url.hostname);
  const literalFamily = isIP(hostname);
  if (literalFamily === 4 || literalFamily === 6) {
    return {
      url,
      addresses: [{ address: hostname, family: literalFamily }],
    };
  }

  const resolver = options.resolver ?? defaultResolver;
  let answers: readonly ResolvedOutboundAddress[];
  try {
    answers = await resolveWithSignal(resolver, hostname, options.signal);
  } catch (cause) {
    if (cause instanceof OutboundHttpPolicyError) throw cause;
    throw new OutboundHttpPolicyError(
      'dns_resolution_failed',
      'Outbound hostname could not be resolved safely',
      { cause },
    );
  }

  throwIfAborted(options.signal);
  if (answers.length === 0) {
    throw new OutboundHttpPolicyError(
      'dns_resolution_failed',
      'Outbound hostname did not resolve to an address',
    );
  }

  const deduplicated = new Map<string, ResolvedOutboundAddress>();
  for (const answer of answers) {
    const actualFamily = isIP(answer.address);
    if ((actualFamily !== 4 && actualFamily !== 6) || actualFamily !== answer.family) {
      throw new OutboundHttpPolicyError(
        'dns_resolution_failed',
        'Outbound hostname returned an invalid DNS answer',
      );
    }
    if (!isPublicOutboundAddress(answer.address)) {
      throw new OutboundHttpPolicyError(
        'blocked_address',
        'Outbound hostname resolved to a non-public address',
      );
    }
    deduplicated.set(`${answer.family}:${answer.address}`, answer);
  }

  return { url, addresses: [...deduplicated.values()] };
}

type NodeLookupCallback = (
  error: NodeJS.ErrnoException | null,
  address: string | LookupAddress[],
  family?: number,
) => void;

function createPolicyLookup(resolver: OutboundDnsResolver) {
  return (hostname: string, options: LookupOptions, callback: NodeLookupCallback): void => {
    validateOutboundHttpUrl(`https://${hostname}`, { resolver })
      .then(({ addresses }) => {
        const requestedFamily = options.family === 4 || options.family === 6 ? options.family : 0;
        const candidates = addresses.filter(
          (address) => requestedFamily === 0 || address.family === requestedFamily,
        );
        if (candidates.length === 0) {
          const error = new Error('No safe address matched the requested family') as NodeJS.ErrnoException;
          error.code = 'ENOTFOUND';
          callback(error, '');
          return;
        }

        if (options.all) {
          callback(
            null,
            candidates.map((candidate) => ({
              address: candidate.address,
              family: candidate.family,
            })),
          );
          return;
        }

        callback(null, candidates[0].address, candidates[0].family);
      })
      .catch((cause) => {
        const error = new Error('Outbound DNS policy rejected the connection', {
          cause,
        }) as NodeJS.ErrnoException;
        error.code = 'EHOSTUNREACH';
        callback(error, '');
      });
  };
}

const defaultTlsDispatcher = new Agent({
  connect: { lookup: createPolicyLookup(defaultResolver) },
});

const defaultInsecureTlsDispatcher = new Agent({
  connect: {
    lookup: createPolicyLookup(defaultResolver),
    rejectUnauthorized: false,
  },
});

/**
 * Undici dispatcher whose connection-time lookup rejects every non-public DNS
 * answer. Validation is intentionally repeated inside the socket lookup so a
 * DNS change between preflight and connection cannot redirect the request to a
 * private address.
 */
export function getSafeOutboundDispatcher(validateTls: boolean = true): Agent {
  return validateTls ? defaultTlsDispatcher : defaultInsecureTlsDispatcher;
}
