import { isIPv4, isIPv6 } from "node:net";

const ipv4Blocks: ReadonlyArray<readonly [string, number]> = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];

function parseIpv4(address: string): number | null {
  if (!isIPv4(address)) return null;
  const parts = address.split(".").map(Number);
  if (parts.length !== 4) return null;
  const [a, b, c, d] = parts as [number, number, number, number];
  return (((a << 24) | (b << 16) | (c << 8) | d) >>> 0) >>> 0;
}

function maskFor(prefix: number): number {
  if (prefix <= 0) return 0;
  return (0xffffffff << (32 - prefix)) >>> 0;
}

function inIpv4Block(value: number, base: string, prefix: number): boolean {
  const block = parseIpv4(base);
  if (block === null) return false;
  const mask = maskFor(prefix);
  return (value & mask) === (block & mask);
}

function isPublicIpv4Value(value: number): boolean {
  return !ipv4Blocks.some(([base, prefix]) => inIpv4Block(value, base, prefix));
}

function expandIpv6(address: string): number[] | null {
  const zone = address.indexOf("%");
  const scoped = zone === -1 ? address : address.slice(0, zone);
  if (!isIPv6(scoped)) return null;

  let text = scoped;
  const embedded = /(\d{1,3}(?:\.\d{1,3}){3})$/.exec(text);
  if (embedded) {
    const value = parseIpv4(embedded[1] ?? "");
    if (value === null) return null;
    const high = (value >>> 16).toString(16);
    const low = (value & 0xffff).toString(16);
    text = `${text.slice(0, embedded.index)}${high}:${low}`;
  }

  const [head = "", tail] = text.split("::");
  const headParts = head === "" ? [] : head.split(":");
  const tailParts = tail === undefined || tail === "" ? [] : tail.split(":");
  const missing = 8 - headParts.length - tailParts.length;
  if (tail === undefined ? headParts.length !== 8 : missing < 0) return null;
  const padding = Array.from({ length: tail === undefined ? 0 : missing }, () => "0");
  const hextets = [...headParts, ...padding, ...tailParts].map((part) => Number.parseInt(part, 16));
  if (hextets.length !== 8) return null;
  if (hextets.some((value) => !Number.isInteger(value) || value < 0 || value > 0xffff)) return null;
  return hextets;
}

function isPublicIpv6(address: string): boolean {
  const hextets = expandIpv6(address);
  if (hextets === null) return false;
  const [h0, h1, h2, h3, h4, h5, h6, h7] = hextets as [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ];

  if (h0 === 0 && h1 === 0 && h2 === 0 && h3 === 0 && h4 === 0 && h5 === 0xffff) {
    return isPublicIpv4Value((((h6 << 16) | h7) >>> 0) >>> 0);
  }
  if (h0 === 0 && h1 === 0 && h2 === 0 && h3 === 0 && h4 === 0 && h5 === 0) return false;
  if ((h0 & 0xe000) !== 0x2000) return false;
  if (h0 === 0x2001 && h1 <= 0x01ff) return false;
  if (h0 === 0x2001 && h1 === 0x0db8) return false;
  if (h0 === 0x2002) return false;
  if (h0 === 0x3fff && h1 <= 0x0fff) return false;
  return true;
}

export function isPublicAddress(address: string): boolean {
  const value = address.trim();
  const ipv4 = parseIpv4(value);
  if (ipv4 !== null) return isPublicIpv4Value(ipv4);
  const zone = value.indexOf("%");
  const candidate = zone === -1 ? value : value.slice(0, zone);
  if (isIPv6(candidate)) return isPublicIpv6(candidate);
  return false;
}
