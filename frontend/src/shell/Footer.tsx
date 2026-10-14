import { Anchor, Group, Text } from '@mantine/core'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { LanguageSwitch } from '../i18n/LanguageSwitch'

// Proper names and addresses: the same in every language, so they live here
// and not in the catalogues. Only the words around them are translated.
export const AUTHOR = {
  name: 'Sergey Vorobev',
  links: [
    { label: 'vorobev.dev', href: 'https://vorobev.dev' },
    { label: 'GitHub', href: 'https://github.com/sergeyvuser' },
    { label: 'Telegram', href: 'https://t.me/Sergei_Vorobev' },
  ],
  source: 'https://github.com/sergeyvuser/demo-fastapi-app',
} as const

// The public screens' footer — Landing, Sign in, Register, and every screen
// outside the signed-in layout. The site is part of a CV, so whoever just
// tried the demo can see whose it is and reach them in one click.
export function PublicFooter() {
  const { t } = useTranslation()

  return (
    <FooterFrame>
      <Group gap="xs" wrap="wrap">
        <Text size="sm" c="dimmed">
          {t('shell.footer.author', { name: AUTHOR.name })}
        </Text>
        {AUTHOR.links.map((link) => (
          <ExternalLink key={link.href} href={link.href}>
            {link.label}
          </ExternalLink>
        ))}
        <ExternalLink href={AUTHOR.source}>{t('shell.footer.source')}</ExternalLink>
      </Group>
    </FooterFrame>
  )
}

// Signed in, the footer is only the language switch until Account (ticket 29)
// carries it too.
export function SignedInFooter() {
  return <FooterFrame />
}

function FooterFrame({ children }: { children?: ReactNode }) {
  return (
    <Group component="footer" justify="space-between" gap="sm" pt="xl" wrap="wrap">
      {children ?? <span />}
      <LanguageSwitch />
    </Group>
  )
}

// A new tab with no opener: the page we link to cannot reach back into this
// one through `window.opener`, and learns nothing from a Referer header.
function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Anchor href={href} target="_blank" rel="noopener noreferrer" size="sm">
      {children}
    </Anchor>
  )
}
