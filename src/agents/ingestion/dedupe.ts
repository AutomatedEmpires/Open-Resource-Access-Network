import crypto from 'node:crypto';

type HexSha256 = string;

function sha256Hex(input: string): HexSha256 {
  return crypto.createHash('sha256').update(input, 'utf8').digest('hex');
}

export function computeFetchKeySha256(canonicalUrl: string): HexSha256 {
  return sha256Hex(canonicalUrl);
}

export function computeExtractKeySha256(canonicalUrl: string, contentHashSha256: string): HexSha256 {
  return sha256Hex(`${canonicalUrl}|${contentHashSha256}`);
}
