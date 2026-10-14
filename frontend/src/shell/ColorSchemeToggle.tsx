import {
  ActionIcon,
  useComputedColorScheme,
  useMantineColorScheme,
  type ActionIconProps,
} from '@mantine/core'
import { useTranslation } from 'react-i18next'

// As on vorobev.dev: until the first click the scheme follows the system, and
// a click pins the opposite of what is on screen now. There is no way back to
// "follow the system" short of clearing the key — the same trade the site makes
// for a single two-state button instead of a three-way menu.
export function useColorSchemeSwitch() {
  const { t } = useTranslation()
  const { setColorScheme } = useMantineColorScheme()
  // What is rendered, "auto" already resolved against the media query.
  const current = useComputedColorScheme('light')
  const next = current === 'dark' ? 'light' : 'dark'

  return {
    label: t(next === 'dark' ? 'common.colorScheme.toDark' : 'common.colorScheme.toLight'),
    icon: next === 'dark' ? <MoonIcon /> : <SunIcon />,
    toggle: () => setColorScheme(next),
  }
}

// The header's button. Signed in on a phone it gives its place up to the user
// menu, which carries the same switch as an item: brand, two destinations,
// this and the avatar measure 404 px against 375.
export function ColorSchemeToggle(props: Pick<ActionIconProps, 'visibleFrom'>) {
  const { label, icon, toggle } = useColorSchemeSwitch()

  return (
    <ActionIcon
      variant="subtle"
      color="gray"
      size="lg"
      aria-label={label}
      onClick={toggle}
      {...props}
    >
      {icon}
    </ActionIcon>
  )
}

// Two icons do not earn an icon library. Feather's shapes, as on the site;
// `currentColor` so the button's colour is the icon's.
function SunIcon() {
  return (
    <svg {...ICON}>
      <circle cx="12" cy="12" r="5" />
      <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
    </svg>
  )
}

function MoonIcon() {
  return (
    <svg {...ICON}>
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  )
}

const ICON = {
  width: 18,
  height: 18,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  // the button carries the name; the picture is decoration
  'aria-hidden': true,
} as const
