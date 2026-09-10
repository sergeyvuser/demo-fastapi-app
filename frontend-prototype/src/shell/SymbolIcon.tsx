import { Avatar, Text } from '@mantine/core';
import {
  IconCurrencyBitcoin,
  IconCurrencyDogecoin,
  IconCurrencyEthereum,
  IconCurrencySolana,
  IconCurrencyXrp,
} from '@tabler/icons-react';
import type { ComponentType } from 'react';

/**
 * The instrument's mark. Tabler ships glyphs for five of the eight Symbols in the Subscription and
 * nothing for the rest — which is the finding, not an accident: real coin logos would have to be
 * bundled as assets, because ticket 08's CSP allows no external image host.
 */
const GLYPHS: Record<string, { icon: ComponentType<{ size?: number }>; color: string }> = {
  BTCUSDT: { icon: IconCurrencyBitcoin, color: 'orange' },
  ETHUSDT: { icon: IconCurrencyEthereum, color: 'indigo' },
  SOLUSDT: { icon: IconCurrencySolana, color: 'violet' },
  XRPUSDT: { icon: IconCurrencyXrp, color: 'dark' },
  DOGEUSDT: { icon: IconCurrencyDogecoin, color: 'yellow' },
};

const FALLBACK_COLORS: Record<string, string> = {
  BNBUSDT: 'yellow',
  ADAUSDT: 'blue',
  LINKUSDT: 'cyan',
};

export function SymbolIcon({ symbol, size = 28 }: { symbol: string; size?: number }) {
  const glyph = GLYPHS[symbol];
  const base = symbol.replace('USDT', '');

  if (glyph) {
    const Icon = glyph.icon;
    return (
      <Avatar size={size} radius="xl" color={glyph.color} variant="light">
        <Icon size={Math.round(size * 0.6)} />
      </Avatar>
    );
  }

  return (
    <Avatar size={size} radius="xl" color={FALLBACK_COLORS[symbol] ?? 'gray'} variant="light">
      <Text size={size > 24 ? 'xs' : '9px'} fw={700}>
        {base.slice(0, 3)}
      </Text>
    </Avatar>
  );
}
