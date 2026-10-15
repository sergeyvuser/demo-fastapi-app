from pydantic import BaseModel, Field


class AccessToken(BaseModel):
    access_token: str
    token_type: str = "bearer"
    # Seconds until the access token expires, as RFC 6749 section 5.1 names
    # it. The client renews ahead of this instead of waiting for a 401: its
    # longest-lived user of the token is the socket, which makes no requests.
    expires_in: int


class VerificationRequest(BaseModel):
    verification_token: str = Field(
        min_length=43,  # Base64URL (32 b) verification token secrets.token_urlsafe(32)
        max_length=43,
        pattern=r"^[A-Za-z0-9\-_]+$",
        description="the token from the link in the verification e-mail",
    )
