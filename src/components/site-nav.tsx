import Link from 'next/link'

const ITEMS = [
  { href: '/', label: 'Home' },
  { href: '/contracts', label: 'Ledger' },
  { href: '/wire', label: 'Wire' },
] as const

/**
 * One consistent nav, present on every page (Home, Ledger, Wire, Company).
 * Before this, each page hand-rolled its own link set (some had "Graph",
 * some didn't, none had all three) -- a real source of the "where am I,
 * how do I get back" confusion reported live on the site.
 */
export function SiteNav({ current }: { current?: (typeof ITEMS)[number]['href'] }) {
  return (
    <nav className="flex items-center gap-3 text-xs text-[#6B6F7A]">
      {ITEMS.map(item => (
        <Link
          key={item.href}
          href={item.href}
          className={
            item.href === current
              ? 'text-[#F2F3F5]'
              : 'underline-offset-2 hover:text-[#A5A8B0] hover:underline'
          }
        >
          {item.label}
        </Link>
      ))}
    </nav>
  )
}
