import { Skeleton, Stack } from '@mantine/core'

// What a signed-in route shows while the boot refresh is in the air: the
// shell is already real around it, so this is only the content's outline —
// a heading and a few cards — and nothing jumps when the screen arrives. Not a
// spinner: a spinner says "wait", this says what is about to be here.
export function ContentSkeleton() {
  return (
    <Stack gap="md" data-testid="content-skeleton" aria-busy="true">
      <Skeleton height={28} width={180} />
      <Skeleton height={96} />
      <Skeleton height={96} />
      <Skeleton height={96} />
    </Stack>
  )
}
