import { Paper, Stack } from '@mantine/core'
import type { ReactNode } from 'react'

// Sign in and Register share one frame: a narrow column, because a form
// stretched to 1440 px is a form nobody can follow line to line.
export function AuthCard({ children }: { children: ReactNode }) {
  return (
    <Paper maw={420} mx="auto" mt="xl" p="lg" withBorder radius="md">
      <Stack gap="md">{children}</Stack>
    </Paper>
  )
}
