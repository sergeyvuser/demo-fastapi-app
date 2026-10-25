import {
  Checkbox,
  CloseButton,
  Combobox,
  Group,
  Input,
  InputBase,
  Pill,
  Text,
  useCombobox,
} from '@mantine/core'
import { useTranslation } from 'react-i18next'

import { CoinMark } from '../prices/CoinMark'

// How many picked Symbols the closed control names before it says `+N`.
const SHOWN = 2

// A Symbol filter that stays one row high. Mantine's `MultiSelect` grows as
// pills accumulate and shoves the list down; its `maxValues` caps what may be
// picked, not what is drawn. So this is built from `Combobox`: the target is
// a button naming the first two Symbols and a `+N` tail, and the full list,
// with a checkbox each, lives in the dropdown.
export function SymbolFilter({
  options,
  value,
  onChange,
}: {
  options: readonly string[]
  value: readonly string[]
  onChange: (value: string[]) => void
}) {
  const { t } = useTranslation()
  const combobox = useCombobox({ onDropdownClose: () => combobox.resetSelectedOption() })
  const shown = value.slice(0, SHOWN)
  const rest = value.length - shown.length

  return (
    <Combobox
      store={combobox}
      position="bottom-start"
      onOptionSubmit={(symbol) =>
        onChange(
          value.includes(symbol) ? value.filter((picked) => picked !== symbol) : [...value, symbol],
        )
      }
    >
      <Combobox.Target>
        <InputBase
          component="button"
          type="button"
          size="xs"
          w="100%"
          pointer
          multiline={false}
          aria-label={t('alerts.symbols.label')}
          rightSection={
            value.length > 0 ? (
              <CloseButton
                size="xs"
                // keeps the click from reaching the target and opening the list
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => onChange([])}
                aria-label={t('alerts.symbols.clear')}
              />
            ) : (
              <Combobox.Chevron size="xs" />
            )
          }
          rightSectionPointerEvents={value.length > 0 ? 'all' : 'none'}
          onClick={() => combobox.toggleDropdown()}
        >
          {value.length === 0 ? (
            <Input.Placeholder>{t('alerts.symbols.any')}</Input.Placeholder>
          ) : (
            <Group gap={4} wrap="nowrap" style={{ overflow: 'hidden' }}>
              {shown.map((symbol) => (
                <Pill key={symbol} size="xs">
                  {symbol}
                </Pill>
              ))}
              {rest > 0 && <Pill size="xs">{`+${rest}`}</Pill>}
            </Group>
          )}
        </InputBase>
      </Combobox.Target>

      <Combobox.Dropdown>
        <Combobox.Options mah={280} style={{ overflowY: 'auto' }}>
          {options.map((symbol) => (
            <Combobox.Option value={symbol} key={symbol} active={value.includes(symbol)}>
              <Group gap="xs" wrap="nowrap">
                <Checkbox
                  size="xs"
                  checked={value.includes(symbol)}
                  onChange={() => {}}
                  tabIndex={-1}
                  aria-hidden
                  style={{ pointerEvents: 'none' }}
                />
                <CoinMark symbol={symbol} size={18} />
                <Text size="sm">{symbol}</Text>
              </Group>
            </Combobox.Option>
          ))}
        </Combobox.Options>
      </Combobox.Dropdown>
    </Combobox>
  )
}
