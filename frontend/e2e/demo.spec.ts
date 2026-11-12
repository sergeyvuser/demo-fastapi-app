import { expect, test } from './fixtures.ts'

// Journey 4: the demo path. The seeder has created the account in this stack
// (compose.ci.yaml) — the only place it runs before production — and the
// Landing offers it to anyone signed out.

test('the landing signs in to the demo account, which says what it is', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Sign in to the demo account' }).click()

  await expect(page).toHaveURL(/\/alerts$/)
  await expect(page.getByText(/This is the shared demo account/)).toBeVisible()

  // A Linked chat on a shared account would receive everyone's
  // Notifications, so instead of the form there is the reason why not.
  await page.getByRole('button', { name: 'Account menu' }).click()
  await page.getByRole('menuitem', { name: 'Account' }).click()
  await expect(page.getByText(/The demo account cannot link a Telegram chat/)).toBeVisible()
})
