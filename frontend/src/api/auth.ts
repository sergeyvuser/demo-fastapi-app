import { api, queryClient } from './client'
import { bootSession, endSession, startSession } from './session'

// Sign-in is an OAuth2 password form, not JSON: the backend takes FastAPI's
// OAuth2PasswordRequestForm, which is what keeps /docs' "Authorize" button
// working. The field is called `username` and carries the e-mail address.
export async function signIn(email: string, password: string): Promise<void> {
  // The boot refresh may still be in the air. Signing in first and letting
  // its 401 land afterwards would end the session that was just started.
  await bootSession()
  const { data } = await api.POST('/api/v1/auth/login', {
    // `scope` has a server default, and openapi-typescript types a field
    // with a default as present; empty is what the default is.
    body: { username: email, password, scope: '' },
    // openapi-fetch's default serializer switches to URL encoding on this
    // header alone; without it the body goes out as JSON and the API says 422.
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  })
  // Every non-2xx is thrown by the middleware, so here the body is there.
  startSession(data!.access_token)
}

// The server is told first, while the bearer token is still in hand — logout
// is authenticated by it, and an expired one is refreshed on the way like any
// other call. Whatever the server answers, this browser is signed out after.
export async function signOut(): Promise<void> {
  try {
    await api.POST('/api/v1/auth/logout')
  } catch {
    // Already revoked elsewhere, or the network failed. The token is dropped
    // either way; a refresh cookie that survived dies on its own in 7 days.
  } finally {
    endSession()
    // One person's data must not be on screen for the next one to sign in.
    queryClient.clear()
  }
}
