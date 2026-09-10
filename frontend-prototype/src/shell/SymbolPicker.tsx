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
} from '@mantine/core';
import { SymbolIcon } from './SymbolIcon';

const PILLS_SHOWN = 2;

/**
 * A Symbol filter that stays one row high.
 *
 * Mantine's `MultiSelect` grows upward as pills accumulate, which moves everything under it — so
 * this is built from `Combobox` instead: the target is a button showing the first few Symbols and a
 * `+N` tail, and the full list with its checkboxes lives in the dropdown.
 */
export function SymbolPicker({
  data,
  value,
  onChange,
}: {
  data: string[];
  value: string[];
  onChange: (value: string[]) => void;
}) {
  const combobox = useCombobox({ onDropdownClose: () => combobox.resetSelectedOption() });

  const shown = value.slice(0, PILLS_SHOWN);
  const rest = value.length - shown.length;

  return (
    <Combobox
      store={combobox}
      withinPortal
      position="bottom-start"
      onOptionSubmit={(submitted) =>
        onChange(
          value.includes(submitted)
            ? value.filter((symbol) => symbol !== submitted)
            : [...value, submitted],
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
          rightSection={
            value.length > 0 ? (
              <CloseButton
                size="xs"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => onChange([])}
                aria-label="Clear Symbols"
              />
            ) : (
              <Combobox.Chevron size="xs" />
            )
          }
          rightSectionPointerEvents={value.length > 0 ? 'all' : 'none'}
          onClick={() => combobox.toggleDropdown()}
        >
          {value.length === 0 ? (
            <Input.Placeholder>Any Symbol</Input.Placeholder>
          ) : (
            <Group gap={4} wrap="nowrap" style={{ overflow: 'hidden' }}>
              {shown.map((symbol) => (
                <Pill key={symbol} size="xs">
                  {symbol.replace('USDT', '')}
                </Pill>
              ))}
              {rest > 0 && (
                <Pill size="xs" c="dimmed">
                  +{rest}
                </Pill>
              )}
            </Group>
          )}
        </InputBase>
      </Combobox.Target>

      <Combobox.Dropdown>
        <Combobox.Options mah={280} style={{ overflowY: 'auto' }}>
          {data.map((symbol) => (
            <Combobox.Option value={symbol} key={symbol} active={value.includes(symbol)}>
              <Group gap="xs" wrap="nowrap">
                <Checkbox
                  size="xs"
                  checked={value.includes(symbol)}
                  onChange={() => {}}
                  tabIndex={-1}
                  style={{ pointerEvents: 'none' }}
                  aria-hidden
                />
                <SymbolIcon symbol={symbol} size={18} />
                <Text size="sm">{symbol}</Text>
              </Group>
            </Combobox.Option>
          ))}
        </Combobox.Options>
      </Combobox.Dropdown>
    </Combobox>
  );
}
