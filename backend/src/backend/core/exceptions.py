class AppError(Exception):
    """Base domain exception.

    Services raise its subclasses; the HTTP layer renders them.
    """

    status_code: int = 500
    title: str = "Internal Server Error"

    def __init__(
        self, detail: str | None = None, headers: dict[str, str] | None = None
    ):
        self.detail = detail
        self.headers = headers
        super().__init__(detail or self.title)


class NotFoundError(AppError):
    status_code = 404
    title = "Not Found"


class ConflictError(AppError):
    status_code = 409
    title = "Conflict"


class UnauthorizedError(AppError):
    status_code = 401
    title = "Unauthorized"

    def __init__(self, detail: str | None = None):
        super().__init__(detail, headers={"WWW-Authenticate": "Bearer"})
