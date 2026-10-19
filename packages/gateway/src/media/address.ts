import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import { BlockList, isIP, type LookupFunction } from 'node:net';

/*
 * The relay fetches audio from wherever a podcast's feed points, so it must never be
 * turned against this machine or its network. Every connection it makes resolves the host
 * itself and refuses loopback, private, link-local and other special addresses (after the
 * lookup, so a name that resolves to 127.0.0.1 is refused too).
 */

const special = new BlockList();
for (const [net, bits] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  special.addSubnet(net, bits, 'ipv4');
}
for (const [net, bits] of [
  ['::', 128],
  ['::1', 128],
  ['64:ff9b:1::', 48],
  ['100::', 64],
  ['2001:db8::', 32],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as const) {
  special.addSubnet(net, bits, 'ipv6');
}

/** Whether an IP address is on the public internet. */
export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 0) return false;
  if (family === 6) {
    // An IPv4 address written as IPv6 (::ffff:10.0.0.1) is judged as IPv4.
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
    if (mapped) return isPublicAddress(mapped[1]!);
    return !special.check(address, 'ipv6');
  }
  return !special.check(address, 'ipv4');
}

/** A DNS lookup for sockets that fails unless every address it returns is public. */
export const publicLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(hostname, { ...options, all: true }, (error, addresses: LookupAddress[]) => {
    if (error) return callback(error, '', 0);
    const bad = addresses.find((a) => !isPublicAddress(a.address));
    if (bad || addresses.length === 0) {
      const refused = Object.assign(new Error(`${hostname} is not a public address`), {
        code: 'EADDRNOTPUBLIC',
      });
      return callback(refused, '', 0);
    }
    if (options.all)
      return (callback as unknown as (e: null, a: LookupAddress[]) => void)(null, addresses);
    const first = addresses[0]!;
    callback(null, first.address, first.family);
  });
};
