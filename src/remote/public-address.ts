import { isIP } from "node:net";

type Ipv4Range = readonly [network: number, prefix: number];

const BLOCKED_IPV4_RANGES: readonly Ipv4Range[] = [
  [0x00000000, 8],
  [0x0a000000, 8],
  [0x64400000, 10],
  [0x7f000000, 8],
  [0xa9fe0000, 16],
  [0xac100000, 12],
  [0xc0000000, 24],
  [0xc0000200, 24],
  [0xc0586300, 24],
  [0xc0a80000, 16],
  [0xc6120000, 15],
  [0xc6336400, 24],
  [0xcb007100, 24],
  [0xe0000000, 4],
  [0xf0000000, 4],
];

const BLOCKED_IPV6_RANGES: ReadonlyArray<readonly [network: bigint, prefix: number]> = [
  [0x20010000000000000000000000000000n, 23],
  [0x20010db8000000000000000000000000n, 32],
  [0x20020000000000000000000000000000n, 16],
  [0x3ffe0000000000000000000000000000n, 16],
  [0x3fff0000000000000000000000000000n, 20],
];

const ALLOCATED_IPV6_RANGES: ReadonlyArray<readonly [network: bigint, prefix: number]> = [
  [0x20010000000000000000000000000000n, 16],
  [0x20030000000000000000000000000000n, 18],
  [0x24000000000000000000000000000000n, 12],
  [0x26000000000000000000000000000000n, 12],
  [0x28000000000000000000000000000000n, 12],
  [0x2a000000000000000000000000000000n, 12],
  [0x2c000000000000000000000000000000n, 12],
];

function ipv4Number(address: string): number | undefined {
  const octets = address.split(".").map(Number);
  if (
    octets.length !== 4 ||
    octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)
  ) {
    return undefined;
  }
  return (
    ((octets[0] << 24) >>> 0) +
    (octets[1] << 16) +
    (octets[2] << 8) +
    octets[3]
  ) >>> 0;
}

function inIpv4Range(address: number, [network, prefix]: Ipv4Range): boolean {
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (address & mask) >>> 0 === (network & mask) >>> 0;
}

function expandIpv6Parts(parts: string[]): string[] | undefined {
  const output: string[] = [];
  for (const part of parts) {
    if (part.includes(".")) {
      const ipv4 = ipv4Number(part);
      if (ipv4 === undefined) return undefined;
      output.push((ipv4 >>> 16).toString(16), (ipv4 & 0xffff).toString(16));
    } else {
      output.push(part);
    }
  }
  return output;
}

function ipv6Number(address: string): bigint | undefined {
  const halves = address.toLowerCase().split("::");
  if (halves.length > 2) return undefined;
  const left = expandIpv6Parts(halves[0] ? halves[0].split(":") : []);
  const right = expandIpv6Parts(halves[1] ? halves[1].split(":") : []);
  if (!left || !right) return undefined;

  const omitted = halves.length === 2 ? 8 - left.length - right.length : 0;
  if (omitted < 0 || (halves.length === 1 && left.length !== 8)) return undefined;
  const groups = [...left, ...Array.from({ length: omitted }, () => "0"), ...right];
  if (groups.length !== 8 || groups.some((group) => !/^[\da-f]{1,4}$/.test(group))) {
    return undefined;
  }

  return groups.reduce((value, group) => (value << 16n) | BigInt(`0x${group}`), 0n);
}

function inIpv6Range(address: bigint, network: bigint, prefix: number): boolean {
  const shift = 128n - BigInt(prefix);
  return address >> shift === network >> shift;
}

export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    const value = ipv4Number(address);
    return value !== undefined && !BLOCKED_IPV4_RANGES.some((range) => inIpv4Range(value, range));
  }
  if (family !== 6) return false;

  const value = ipv6Number(address);
  if (value === undefined) return false;

  const allocated = ALLOCATED_IPV6_RANGES.some(
    ([network, prefix]) => inIpv6Range(value, network, prefix),
  );
  return allocated && !BLOCKED_IPV6_RANGES.some(
    ([network, prefix]) => inIpv6Range(value, network, prefix),
  );
}
