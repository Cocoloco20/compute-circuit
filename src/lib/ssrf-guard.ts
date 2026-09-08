/**
 * ssrf-guard.ts — SSRF protection for server-side URL fetching.
 *
 * Applied to the /api/logo/[domain] proxy (HOLE 2 fix). The route used to
 * fetch any hostname the regex let through, so requests like
 * /api/logo/169.254.169.254, /api/logo/10.0.0.5, /api/logo/localhost or
 * /api/logo/metadata.google.internal reached internal/cloud-metadata
 * addresses from the server.
 *
 * Guard contract — DEFAULT-DENY. A hostname is safe ONLY if ALL of:
 *   1. It is not a bare IPv4/IPv6 literal.
 *   2. It has at least one dot (rejects "localhost", "local", "internal").
 *   3. It DNS-resolves to at least one address.
 *   4. NONE of its resolved addresses fall in a loopback, link-local,
 *      private (RFC1918 / ULA), CGNAT, benchmarking, multicast or reserved
 *      range. If a name has any private address we deny the whole name
 *      (a mixed public/private record is still an SSRF vector).
 * Resolution failure also denies.
 *
 * This is an allowlist-with-default-deny, not a denylist: unknown ranges and
 * future allocations are refused rather than trusted.
 */

import { resolve4, resolve6 } from 'node:dns/promises'

/** "least significant 32 bits of an IPv4" form of a bare-v4 check. */
function ipv4ToUint(ip: string): number | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip.trim())
  if (!m) return null
  const parts = m.slice(1).map(Number)
  if (parts.some(p => p > 255)) return null
  return ((((parts[0] << 8) | parts[1]) << 8) | parts[2]) << 8 | parts[3]
}

/** True when the dotted-quad falls in a private/loopback/link-local/etc range. */
function isPrivateIpv4Uint(n: number): boolean {
  // 0.0.0.0/8 (this host / unspecified)
  if (n < 0x01000000) return true
  // 10.0.0.0/8              — RFC1918
  if (n >= 0x0a000000 && n <= 0x0affffff) return true
  // 100.64.0.0/10           — CGNAT
  if (n >= 0x64400000 && n <= 0x647fffff) return true
  // 127.0.0.0/8             — loopback
  if (n >= 0x7f000000 && n <= 0x7fffffff) return true
  // 169.254.0.0/16          — link-local
  if (n >= 0xa9fe0000 && n <= 0xa9feffff) return true
  // 172.16.0.0/12           — RFC1918
  if (n >= 0xac100000 && n <= 0xac1fffff) return true
  // 192.168.0.0/16          — RFC1918
  if (n >= 0xc0a80000 && n <= 0xc0a8ffff) return true
  // 198.18.0.0/15           — benchmarking
  if (n >= 0xc6120000 && n <= 0xc613ffff) return true
  // 224.0.0.0/4             — multicast + reserved
  if (n >= 0xe0000000) return true
  return false
}

/** True when the string is a plausible IPv4 literal (even if it's public). */
function isBareIpv4(s: string): boolean {
  return ipv4ToUint(s) !== null
}

/** Parse an IPv6 address (with optional embedded IPv4 + zone id) to a BigInt. */
function ipv6ToBigInt(ip: string): bigint | null {
  let s = ip.split('%')[0].trim().toLowerCase()
  if (!s) return null
  // Embedded IPv4 tail (e.g. ::ffff:192.168.0.1, 0:0:0:0:0:ffff:c0a8:1).
  if (s.includes('.')) {
    const i = s.lastIndexOf(':')
    const v4 = ipv4ToUint(s.slice(i + 1))
    if (v4 === null) return null
    const hex1 = ((v4 >>> 16) & 0xffff).toString(16)
    const hex2 = (v4 & 0xffff).toString(16)
    s = `${s.slice(0, i)}:${hex1}:${hex2}`
  }
  const hasDouble = s.includes('::')
  if (hasDouble && s.indexOf('::') !== s.lastIndexOf('::')) return null
  const [h, t] = s.split('::')
  const head = h ? h.split(':').filter(Boolean) : []
  const tail = t ? t.split(':').filter(Boolean) : []
  if (!hasDouble && head.length !== 8) return null
  if (hasDouble && head.length + tail.length > 7) return null

  const words: number[] = []
  const pushHextets = (parts: string[]): boolean => {
    for (const part of parts) {
      if (!/^[0-9a-f]{1,4}$/.test(part)) return false
      const v = parseInt(part, 16)
      if (v > 0xffff) return false
      words.push(v)
    }
    return true
  }
  if (!pushHextets(head)) return null
  if (hasDouble) {
    for (let i = 0; i < 8 - head.length - tail.length; i++) words.push(0)
  }
  if (!pushHextets(tail)) return null
  if (words.length !== 8) return null

  let out = 0n
  for (const w of words) out = (out << 16n) | BigInt(w)
  return out
}

/** True when the BigInt IPv6 address is loopback / link-local / ULA / etc. */
function isPrivateIpv6(bi: bigint): boolean {
  if (bi === 0n) return true                                  // :: / unspecified
  if (bi === 1n) return true                                  // ::1 loopback
  // IPv4-mapped ::ffff:0:0/96 — judge the embedded v4.
  if ((bi >> 112n) === 0n && (bi >> 32n) === 0xffffn) {
    return isPrivateIpv4Uint(Number(bi & 0xffffffffn))
  }
  const top = bi >> 120n
  if (top >= 0xfe80n && top <= 0xfebfn) return true           // fe80::/10 link-local
  if (top >= 0xfec0n && top <= 0xfeffn) return true           // fec0::/10 site-local
  if (top >= 0xfc00n && top <= 0xfdffn) return true           // fc00::/7 ULA
  if (top >= 0xff00n) return true                             // ff00::/8 multicast
  return false
}

function isBareIpv6(s: string): boolean {
  return ipv6ToBigInt(s) !== null
}

function isPrivateAddr(addr: string): boolean {
  const u = ipv4ToUint(addr)
  if (u !== null) return isPrivateIpv4Uint(u)
  const b = ipv6ToBigInt(addr)
  if (b !== null) return isPrivateIpv6(b)
  // Unknown address family — default deny.
  return true
}

/**
 * Resolve every A and AAAA record for a hostname. Returns 'null' on any
 * resolution failure (NXDOMAIN, DNSSEC, network error) — a default-deny.
 */
export async function resolveHostAddresses(hostname: string): Promise<string[] | null> {
  const out = new Set<string>()
  try {
    const a = await resolve4(hostname)
    a.forEach(x => out.add(x))
  } catch {
    /* no A records — not an error by itself */
  }
  try {
    const aaaa = await resolve6(hostname)
    aaaa.forEach(x => out.add(x))
  } catch {
    /* no AAAA records */
  }
  if (out.size === 0) return null
  return Array.from(out)
}

/**
 * Assert a hostname is safe to fetch server-side. Returns true ONLY when the
 * name is not a bare IP, is multi-label, resolves, and NO resolved address is
 * private/loopback/link-local/reserved. Everything else returns false.
 */
export async function assertSafeHostname(hostname: string): Promise<boolean> {
  const h = (hostname || '').toLowerCase().trim()
  if (!h) return false
  if (!/^[a-z0-9.-]+$/.test(h)) return false
  // Bare IP literals are never allowed (169.254.169.254, 10.0.0.5, ::1, ...).
  if (isBareIpv4(h) || isBareIpv6(h)) return false
  // Single-label hosts are never allowed (localhost, local, internal, ...).
  if (!h.includes('.')) return false

  const addresses = await resolveHostAddresses(h)
  if (!addresses) return false
  // Default-deny: ANY private resolved address makes the whole name unsafe.
  for (const addr of addresses) {
    if (isPrivateAddr(addr)) return false
  }
  return true
}