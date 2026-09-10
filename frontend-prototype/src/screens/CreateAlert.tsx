import {PriceChart} from '../charts/PriceChart';
import {
  Alert as MantineAlert,
  Badge,
  Box,
  Button,
  Card,
  Grid,
  Group,
  NumberInput,
  Paper,
  Radio,
  Select,
  Stack,
  Text,
  Title,
} from '@mantine/core';
import {IconInfoCircle} from '@tabler/icons-react';
import {useMemo, useState} from 'react';
import {BASE_PRICES, type Condition, formatPrice, type RepeatPolicy, SUBSCRIPTION,} from '../fake/domain';
import type {Quotes} from '../fake/useTicker';

/**
 * The create form, rendered because ticket 14 said it is now seven controls rather than four and a
 * form is where prose lies most. Everything here is fake: no submission, no validation beyond what
 * makes the fields legible.
 */
export function CreateAlert({quotes, verified, onCancel}: {
    quotes: Quotes;
    verified: boolean;
    onCancel: () => void
}) {
    const [symbol, setSymbol] = useState<string>('BTCUSDT');
    const [condition, setCondition] = useState<Condition>('price_above');
    const [threshold, setThreshold] = useState<number | string>(70000);
    const [repeat, setRepeat] = useState<RepeatPolicy>('while_true');
    const [cooldown, setCooldown] = useState<number | string>(60);
    const [expiry, setExpiry] = useState<string>('none');

    const price = quotes[symbol]?.price ?? null;
    const thresholdNumber = typeof threshold === 'number' ? threshold : Number(threshold);

    // ticket 14 §3: an `on_cross` Alert whose Condition already holds starts silent, and the form has
    // to say so before saving rather than after.
    const alreadyHolds =
        price !== null &&
        (condition === 'price_above' ? price >= thresholdNumber : price <= thresholdNumber);

    const candles = useMemo(() => fakeCandles(symbol), [symbol]);


    return (
        <Stack gap="md" maw={880}>
            <Title order={2} size="h3">
                New Alert
            </Title>

            <Grid gap="md">
                <Grid.Col span={{base: 12, md: 7}}>
                    <Card withBorder radius="md" padding="lg">
                        <Stack gap="md">
                            {/* 1 — Symbol. Ticket 06: the list is the Subscription, and a price may be null. */}
                            <Select
                                label="Symbol"
                                description="Only Symbols the system streams can be watched"
                                value={symbol}
                                onChange={(value) => value && setSymbol(value)}
                                allowDeselect={false}
                                data={SUBSCRIPTION.map((s) => ({
                                    value: s,
                                    label: `${s}${BASE_PRICES[s] === null ? '  (no price yet)' : ''}`,
                                }))}
                            />

                            {/* 2 — Condition. A Select rather than a two-way toggle, because ticket 05's hedge
                  requires the control to admit a second kind of Condition later. */}
                            <Select
                                label="Condition"
                                value={condition}
                                onChange={(value) => value && setCondition(value as Condition)}
                                allowDeselect={false}
                                data={[
                                    {value: 'price_above', label: 'Price rises above the Threshold'},
                                    {value: 'price_below', label: 'Price falls below the Threshold'},
                                ]}
                            />

                            {/* 3 — Threshold */}
                            <div>
                                <NumberInput
                                    label="Threshold"
                                    description={
                                        price === null
                                            ? 'No price is streaming for this Symbol yet'
                                            : `${symbol} is at ${formatPrice(price)} right now`
                                    }
                                    value={threshold}
                                    onChange={setThreshold}
                                    thousandSeparator=" "
                                    decimalScale={8}
                                    min={0}
                                />
                                {price !== null && (
                                    <Group gap="xs" mt="xs">
                                        {[-5, -1, 1, 5].map((pct) => (
                                            <Button
                                                key={pct}
                                                size="compact-xs"
                                                variant="default"
                                                onClick={() => setThreshold(Number((price * (1 + pct / 100)).toPrecision(8)))}
                                            >
                                                {pct > 0 ? `+${pct}%` : `${pct}%`}
                                            </Button>
                                        ))}
                                    </Group>
                                )}
                            </div>

                            {/* 4 — Repeat policy */}
                            <Radio.Group
                                label="Repeat policy"
                                value={repeat}
                                onChange={(value) => setRepeat(value as RepeatPolicy)}
                            >
                                <Stack gap="xs" mt="xs">
                                    <RepeatOption
                                        value="while_true"
                                        title="While true"
                                        text="Goes off for as long as the Condition holds, spaced out by the Cooldown."
                                    />
                                    <RepeatOption
                                        value="on_cross"
                                        title="On cross"
                                        text="Goes off only at the moment the price crosses the Threshold. Standing past it is silent."
                                    />
                                    <RepeatOption
                                        value="once"
                                        title="Once"
                                        text="Goes off a single time, then the Alert is Finished and cannot be resumed."
                                    />
                                </Stack>
                            </Radio.Group>

                            {alreadyHolds && repeat === 'on_cross' && (
                                <MantineAlert icon={<IconInfoCircle size={16}/>} color="blue" variant="light">
                                    The Condition already holds at {formatPrice(price!)}. This Alert stays silent until
                                    the
                                    price leaves the zone and crosses back.
                                </MantineAlert>
                            )}

                            {/* 5 — Cooldown: required for while_true, optional for on_cross, absent for once */}
                            {repeat !== 'once' && (
                                <NumberInput
                                    label="Cooldown"
                                    description={
                                        repeat === 'while_true'
                                            ? 'The minimum time between two Triggers of this Alert'
                                            : 'Optional. Guards against a price flickering across the Threshold — leave empty for none'
                                    }
                                    suffix=" minutes"
                                    value={cooldown}
                                    onChange={setCooldown}
                                    min={1}
                                    max={1440}
                                />
                            )}

                            {/* 6 — Expiry: a closed preset set, because the server does the arithmetic */}
                            <Select
                                label="Expiry"
                                description="After this the Alert stops watching, whether or not it ever went off"
                                value={expiry}
                                onChange={(value) => value && setExpiry(value)}
                                allowDeselect={false}
                                data={[
                                    {value: 'none', label: 'No Expiry — watch indefinitely'},
                                    {value: '86400', label: '24 hours'},
                                    {value: '604800', label: '7 days'},
                                    {value: '2592000', label: '30 days'},
                                ]}
                            />

                            <Group justify="flex-end" mt="sm">
                                <Button variant="default" onClick={onCancel}>Cancel</Button>
                                <Button disabled={!verified} onClick={onCancel}>Create Alert</Button>
                            </Group>
                            {!verified && (
                                <Text size="xs" c="dimmed" ta="right">
                                    Verify your e-mail first — the API refuses to create an Alert for an unverified
                                    account.
                                </Text>
                            )}
                        </Stack>
                    </Card>
                </Grid.Col>

                <Grid.Col span={{base: 12, md: 5}}>
                    <Card withBorder radius="md" padding="md">
                        <Group justify="space-between" mb="xs">
                            <Text fw={600} size="sm">
                                {symbol}
                            </Text>
                            <Badge size="xs" variant="light" color="gray">
                                last 24 h
                            </Badge>
                        </Group>
                        <PriceChart
                            candles={candles}
                            threshold={thresholdNumber || 0}
                            livePrice={price}
                            height={220}
                        />
                        <Text size="xs" c="dimmed" mt="xs">
                            Proxied from the exchange and stored nowhere — the chart is here so a Threshold can be
                            placed with the last day in view.
                        </Text>
                    </Card>

                    <Paper withBorder radius="md" p="md" mt="md">
                        <Text size="xs" c="dimmed">
                            Summary
                        </Text>
                        <Text size="sm" mt={4}>
                            Watch <b>{symbol}</b> and notify me when the price is{' '}
                            <b>{condition === 'price_above' ? 'above' : 'below'}</b>{' '}
                            <b>{formatPrice(thresholdNumber || 0)}</b>,{' '}
                            {repeat === 'once'
                                ? 'once, and then finish the Alert'
                                : repeat === 'on_cross'
                                    ? 'each time it crosses'
                                    : 'repeatedly while it holds'}
                            {repeat !== 'once' && cooldown ? `, at most every ${cooldown} minutes` : ''}
                            {expiry === 'none' ? ', indefinitely.' : `, for the next ${expiryLabel(expiry)}.`}
                        </Text>
                    </Paper>
                </Grid.Col>
            </Grid>
        </Stack>
    );
}

function RepeatOption({value, title, text}: { value: string; title: string; text: string }) {
    return (
        <Box>
            <Radio value={value} label={<Text fw={600} size="sm">{title}</Text>}/>
            <Text size="xs" c="dimmed" ml={30}>
                {text}
            </Text>
        </Box>
    );
}

function expiryLabel(value: string): string {
    return {'86400': '24 hours', '604800': '7 days', '2592000': '30 days'}[value] ?? '';
}

/** A day of fake closes, so the chart has a shape to argue about. */
function fakeCandles(symbol: string) {
    const base = BASE_PRICES[symbol] ?? 18;
    let price = base * 0.985;
    return Array.from({length: 96}, (_, i) => {
        price *= 1 + (Math.sin(i / 7) * 0.0018 + (Math.random() - 0.48) * 0.0025);
        return {t: `${String(Math.floor(i / 4)).padStart(2, '0')}:00`, close: Number(price.toFixed(2))};
    });
}
