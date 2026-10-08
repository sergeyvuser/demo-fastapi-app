class AppError(Exception):
    """Base domain exception.

    Services raise its subclasses; the HTTP layer renders them.
    """

    status_code: int = 500
    title: str = "Internal Server Error"
    default_detail: str | None = None
    metric_reason: str | None = None

    def __init__(
        self, detail: str | None = None, headers: dict[str, str] | None = None
    ):
        self.detail = detail or self.default_detail
        self.headers = headers
        super().__init__(self.detail or self.title)


class NotFoundError(AppError):
    status_code = 404
    title = "Not Found"


class ConflictError(AppError):
    status_code = 409
    title = "Conflict"


class BadRequestError(AppError):
    status_code = 400
    title = "Bad Request"


class UnauthorizedError(AppError):
    status_code = 401
    title = "Unauthorized"

    def __init__(self, detail: str | None = None):
        super().__init__(detail, headers={"WWW-Authenticate": "Bearer"})


class GoneError(AppError):
    status_code = 410
    title = "Gone"


class ServiceUnavailableError(AppError):
    """We depend on something that cannot answer right now: "later", not "broken"."""

    status_code = 503
    title = "Service Unavailable"

    def __init__(self, detail: str | None = None, *, retry_after: int):
        super().__init__(detail, headers={"Retry-After": str(retry_after)})
