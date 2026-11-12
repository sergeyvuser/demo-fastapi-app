import { expect, test } from './fixtures.ts'
import { newAccount } from './support/accounts.ts'
import { verificationLink } from './support/mailpit.ts'

// Journey 1: a stranger becomes a user who can create Alerts. Registration
// through the form, the letter out of Mailpit, its link followed exactly as
// it was sent, and the app again with the read-only banner gone.

test('register, follow the letter, and reach the app with no read-only banner', async ({
  page,
}) => {
  const account = newAccount()
  const banner = page.getByText('Confirm your e-mail address')

  await page.goto('/register')
  await page.getByLabel('Username').fill(account.username)
  await page.getByLabel('E-mail').fill(account.email)
  await page.getByLabel('Password', { exact: true }).fill(account.password)
  await page.getByRole('button', { name: 'Create account' }).click()

  // Signed in at once, but read-only until the address is confirmed.
  await expect(page).toHaveURL(/\/alerts$/)
  await expect(banner).toBeVisible()

  // The link as the worker wrote it — its origin is the API's PUBLIC_URL,
  // so a mismatch with the edge fails here, not in someone's inbox.
  await page.goto(await verificationLink(account.email))
  await expect(page.getByText('Your address is confirmed')).toBeVisible()

  await page.getByRole('link', { name: 'Go to your Alerts' }).click()
  await expect(page).toHaveURL(/\/alerts$/)
  // The list has rendered — and with it the slot the banner would sit in.
  await expect(page.getByRole('link', { name: 'Create your first Alert' })).toBeVisible()
  await expect(banner).toBeHidden()
})
