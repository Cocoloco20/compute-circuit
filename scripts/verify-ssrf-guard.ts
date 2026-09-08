/**
 * Local verification of the SSRF guard — HOLE 2.
 * Proves assertSafeHostname denies every documented attack vector and
 * allows a normal public hostname. Not a test that ships; scratch only.
 */
import { assertSafeHostname } from '../src/lib/ssrf-guard'

async function main() {
  // Every attack listed in the task must be DENIED.
  const attacks = [
    '169.254.169.254', // AWS/GCP/Azure metadata
    '10.0.0.5',        // RFC1918 private
    'localhost',       // single-label loopback
    '127.0.0.1',       // bare loopback IP
    'metadata.google.internal',
    '::1',
    '192.168.1.10',
    '172.16.0.1',
  ]
  // Legitimate public hosts must be ALLOWED (resolves to a public addr).
  const allowed = ['example.com', 'www.google.com']

  let failed = false
  for (const h of attacks) {
    const ok = await assertSafeHostname(h)
    const pass = ok === false
    if (!pass) failed = true
    console.log(`${pass ? 'PASS' : 'FAIL'} deny   : ${h} -> ${ok}`)
  }
  for (const h of allowed) {
    const ok = await assertSafeHostname(h)
    const pass = ok === true
    if (!pass) failed = true
    console.log(`${pass ? 'PASS' : 'FAIL'} allow  : ${h} -> ${ok}`)
  }
  console.log(failed ? 'RESULT: FAIL' : 'RESULT: PASS')
  process.exit(failed ? 1 : 0)
}

main()