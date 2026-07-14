class AppError(Exception):
    """Base domain exception for all app errors. Services throw its subclasses, HTTP layer renders."""

    status_code: int = 500
    title: str = "Internal Server Error"
    headers: dict[str, str] | None = None

    def __init__(self, detail: str | None = None):
        self.detail = detail
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
    headers = {"WWW-Authenticate": "Bearer"}
