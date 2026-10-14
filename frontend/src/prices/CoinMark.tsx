import { Avatar, type MantineSize } from '@mantine/core'

import { useSymbols } from './store'

// Every file in the folder, as a URL (or an inlined data: URL under Vite's
// size limit — the CSP admits `data:` images). Built at compile time: nothing
// is fetched from anywhere but this origin.
const FILES = import.meta.glob<string>('../assets/coins/*.svg', {
  eager: true,
  query: '?url',
  import: 'default',
})

const ICONS = new Map(
  Object.entries(FILES).map(([path, url]) => [path.replace(/^.*\/(.+)\.svg$/, '$1'), url]),
)

// The quote assets the Subscription trades against. A Symbol is never
// formatted for display; this split only picks a picture.
const QUOTES = ['USDT', 'USDC']

export function baseAsset(symbol: string): string {
  const quote = QUOTES.find((candidate) => symbol.endsWith(candidate) && symbol !== candidate)
  return quote ? symbol.slice(0, -quote.length) : symbol
}

export function coinIcon(symbol: string): string | undefined {
  return ICONS.get(baseAsset(symbol).toLowerCase())
}

// All or none: one Symbol without a picture turns every mark into a letter.
// A screen of logos with one lettered circle among them looks broken; a
// screen of letters looks designed.
export function allHaveIcons(symbols: readonly string[]): boolean {
  return symbols.every((symbol) => coinIcon(symbol) !== undefined)
}

// Decorative: the Symbol is always written beside it, so the picture carries
// nothing a screen reader should repeat.
export function CoinMark({ symbol, size }: { symbol: string; size: MantineSize | number }) {
  const symbols = useSymbols() ?? []
  const icon = allHaveIcons(symbols) ? coinIcon(symbol) : undefined

  return (
    <Avatar src={icon} alt="" aria-hidden size={size} radius="xl" color="gray">
      {baseAsset(symbol).charAt(0)}
    </Avatar>
  )
}
