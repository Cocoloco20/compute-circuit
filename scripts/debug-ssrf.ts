import { resolveHostAddresses, assertSafeHostname } from '../src/lib/ssrf-guard'

async function main() {
  for (const h of ['example.com', 'www.google.com', '169.254.169.254']) {
    const addrs = await resolveHostAddresses(h)
    console.log(`${h} -> ${addrs}`)
    const ok = await assertSafeHostname(h)
    console.log(`  assertSafeHostname: ${ok}`)
  }
}
main()