import { ActionIcon, Avatar, Menu } from '@mantine/core'
import { Link, useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'

import { signOut } from '../api/auth'
import { $api } from '../api/client'
import { useColorSchemeSwitch } from './ColorSchemeToggle'

// The person's own corner: Account and the way out. A menu rather than a
// third navigation item, because it is reached rarely and the header has no
// room for it at 375 px.
export function UserMenu() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  // An ordinary query: /me is server state, unlike the token. Until it lands
  // the avatar is simply blank.
  const { data: me } = $api.useQuery('get', '/api/v1/users/me')
  const scheme = useColorSchemeSwitch()

  return (
    <Menu position="bottom-end" width={220}>
      <Menu.Target>
        <ActionIcon variant="subtle" radius="xl" size="lg" aria-label={t('shell.userMenu')}>
          <Avatar size={32} color="aurora" name={me?.username} />
        </ActionIcon>
      </Menu.Target>
      <Menu.Dropdown>
        {me && <Menu.Label>{me.email}</Menu.Label>}
        <Menu.Item renderRoot={(props) => <Link to="/account" {...props} />}>
          {t('shell.account')}
        </Menu.Item>
        {/* the header's toggle steps aside below `sm`; this takes its place */}
        <Menu.Item hiddenFrom="sm" leftSection={scheme.icon} onClick={scheme.toggle}>
          {scheme.label}
        </Menu.Item>
        <Menu.Item
          onClick={() => {
            // Off the signed-in subtree first: the session's end re-runs the
            // guards, and a guard still matched would send a person who chose
            // to leave to the sign-in screen, as if the session had expired.
            void navigate({ to: '/' }).then(signOut)
          }}
        >
          {t('shell.signOut')}
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  )
}
