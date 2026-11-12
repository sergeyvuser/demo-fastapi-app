import { expect, test } from './fixtures.ts'

// Journey 2: the whole conveyor, and the only test that runs it. A Tick goes
// into the broker, the evaluator fires the Alert, the Trigger comes back over
// the socket, and the screen follows without a reload — the card changes
// state and History has the row.

const SYMBOL = 'BTCUSDT'

test('a crossing Tick fires the Alert, and the Trigger reaches the card and History', async ({
  page,
  account: _account,
  ticks,
}) => {
  // Every frame the server sends to this page, to tell a Trigger that came
  // over the socket from one picked up by some later refetch.
  const frames: { type?: string }[] = []
  page.on('websocket', (socket) => {
    socket.on('framereceived', ({ payload }) => {
      if (typeof payload === 'string') frames.push(JSON.parse(payload) as { type?: string })
    })
  })

  // Below the Threshold before the Alert exists, so it is created quiet.
  await ticks.setPrice(SYMBOL, 60_000)

  await page.goto('/alerts/new')
  await page.getByRole('combobox', { name: 'Symbol' }).click()
  await page.getByRole('option', { name: SYMBOL }).click()
  await page.getByText('Price above', { exact: true }).click()
  await page.getByLabel('Threshold').fill('64000')
  // Once: after one Trigger the Alert is completed — a change of state the
  // card shows outright, not just a counter going up.
  await page.getByRole('radio', { name: /^Once/ }).check()
  await page.getByRole('button', { name: 'Create Alert' }).click()

  await expect(page).toHaveURL(/\/alerts$/)
  const card = page.getByTestId('alert-card').filter({ hasText: SYMBOL })
  await expect(card).toHaveCount(1)
  await expect(card).toContainText('Never triggered')

  // The Alert has never fired, so this first crossing needs no clock.
  await ticks.setPrice(SYMBOL, 65_000)

  await expect
    .poll(() => frames.some((frame) => frame.type === 'trigger'), {
      message: 'no Trigger frame arrived over the socket',
    })
    .toBe(true)
  await expect(card).toContainText('Completed')
  await expect(card).toContainText('1 Trigger')

  await page.getByRole('link', { name: 'History' }).click()
  const row = page.getByTestId('trigger-row').filter({ hasText: SYMBOL })
  await expect(row).toHaveCount(1)
  await expect(row).toContainText('above 64,000')
  await expect(row).toContainText('at 65,000')
})
