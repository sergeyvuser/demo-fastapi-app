import {
  ActionIcon,
  Badge,
  Group,
  Paper,
  SegmentedControl,
  Switch,
  Text,
  Tooltip,
} from '@mantine/core';
import { IconChevronLeft, IconChevronRight } from '@tabler/icons-react';
import { useEffect } from 'react';
import type { Params, Variant } from './params';

export const VARIANTS: Variant[] = ['D', 'A', 'B', 'C'];

export const VARIANT_NAMES: Record<Variant, string> = {
  D: 'A revised — icons, axis, detail panel',
  A: 'Cards, one per Alert',
  B: 'Dense table + Trigger rail',
  C: 'Grouped board, distance axis',
};

interface Props {
  params: Params;
  update: (patch: Partial<Params>) => void;
}

/**
 * The prototype's own control surface. Deliberately ugly and high-contrast so nobody mistakes it
 * for part of the design being judged.
 */
export function PrototypeBar({ params, update }: Props) {
  const showVariants = params.screen === 'alerts';

  useEffect(() => {
    if (!showVariants) return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.closest('input, textarea, [contenteditable]') || target.isContentEditable))
        return;
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      const index = VARIANTS.indexOf(params.variant);
      const delta = event.key === 'ArrowRight' ? 1 : -1;
      update({ variant: VARIANTS[(index + delta + VARIANTS.length) % VARIANTS.length] });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [params.variant, showVariants, update]);

  const cycle = (delta: number) => {
    const index = VARIANTS.indexOf(params.variant);
    update({ variant: VARIANTS[(index + delta + VARIANTS.length) % VARIANTS.length] });
  };

  return (
    <Paper
      shadow="xl"
      radius="xl"
      withBorder
      px="md"
      py={6}
      style={{
        position: 'fixed',
        bottom: 12,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 400,
        background: 'var(--mantine-color-dark-9)',
        borderColor: 'var(--mantine-color-lime-5)',
        maxWidth: 'calc(100vw - 16px)',
      }}
    >
      <Group gap="xs" wrap="wrap" justify="center">
        <Badge color="lime" variant="filled" radius="sm">
          PROTOTYPE
        </Badge>

        {showVariants && (
          <Group gap={4} wrap="nowrap">
            <ActionIcon variant="subtle" color="gray" onClick={() => cycle(-1)} aria-label="Previous variant">
              <IconChevronLeft size={16} />
            </ActionIcon>
            <Text c="white" size="xs" fw={600} style={{ whiteSpace: 'nowrap' }}>
              {params.variant} — {VARIANT_NAMES[params.variant]}
            </Text>
            <ActionIcon variant="subtle" color="gray" onClick={() => cycle(1)} aria-label="Next variant">
              <IconChevronRight size={16} />
            </ActionIcon>
          </Group>
        )}

        <Tooltip label="Which fake data set the screen renders">
          <SegmentedControl
            size="xs"
            value={params.data}
            onChange={(value) => update({ data: value as Params['data'] })}
            data={[
              { value: 'normal', label: '8' },
              { value: 'empty', label: 'empty' },
              { value: 'many', label: '22' },
            ]}
          />
        </Tooltip>

        <Switch
          size="xs"
          color="lime"
          checked={params.live}
          onChange={(event) => update({ live: event.currentTarget.checked })}
          label={<Text c="white" size="xs">live</Text>}
        />
        <Switch
          size="xs"
          color="lime"
          checked={!params.verified}
          onChange={(event) => update({ verified: !event.currentTarget.checked })}
          label={<Text c="white" size="xs">unverified</Text>}
        />
      </Group>
    </Paper>
  );
}
