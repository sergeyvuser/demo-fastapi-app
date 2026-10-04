// Mantine exports a component called Alert, and this application is about
// Alerts: the domain type owns the bare name, the component never gets it.
// Every file imports it as MantineAlert, so the two can never collide.
import { Alert as MantineAlert } from '@mantine/core'

export function NotFound() {
    return (
        <MantineAlert color="gray" title="Page not found">
            There is nothing at this address.
        </MantineAlert>
    )
}