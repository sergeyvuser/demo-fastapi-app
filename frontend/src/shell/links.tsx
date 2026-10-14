import { Anchor, Button, type AnchorProps, type ButtonProps } from '@mantine/core'
import { createLink } from '@tanstack/react-router'
import type { ComponentPropsWithRef } from 'react'

// Mantine draws, the router navigates. `createLink` makes `to`, `params` and
// `search` type-checked against the route tree on a Mantine component, which
// `component={Link}` would not: Mantine's polymorphism erases them to `any`.
// The router also marks the current destination with `aria-current="page"`,
// which is what the navigation styles and what a screen reader announces.

export const ButtonLink = createLink(
  (props: ButtonProps & Omit<ComponentPropsWithRef<'a'>, 'color' | 'style'>) => (
    <Button component="a" {...props} />
  ),
)

export const AnchorLink = createLink(
  (props: AnchorProps & Omit<ComponentPropsWithRef<'a'>, 'color' | 'style'>) => (
    <Anchor {...props} />
  ),
)
