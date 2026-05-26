"""JWT verification for the WebSocket gateway.

The gateway doesn't issue tokens — the main FastAPI app does. We just verify
HMAC-SHA-256 signed JWTs against a shared secret. ``JWT_SECRET`` must be set
in the gateway container.

Anonymous connections are allowed for public match channels; user-scoped
channels (``user.<id>``) require auth.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Optional

logger = logging.getLogger(__name__)

try:
    import jwt
    JWT_AVAILABLE = True
except Exception:  # pragma: no cover
    jwt = None  # type: ignore[assignment]
    JWT_AVAILABLE = False


@dataclass(frozen=True)
class AuthPrincipal:
    """Authenticated identity for a websocket connection."""

    user_id: Optional[str]                  # None = anonymous
    scopes: tuple[str, ...] = ()

    @property
    def is_anonymous(self) -> bool:
        return self.user_id is None


ANONYMOUS = AuthPrincipal(user_id=None)


def verify_token(token: Optional[str], *, secret: Optional[str], algorithm: str = "HS256") -> AuthPrincipal:
    """Return the principal for this token, or :data:`ANONYMOUS` if no token.

    Raises :class:`ValueError` for an invalid token (caller should send
    ErrorMessage + close).
    """
    if not token:
        return ANONYMOUS
    if not secret:
        raise ValueError("Gateway not configured for auth (JWT_SECRET missing)")
    if not JWT_AVAILABLE:
        raise ValueError("PyJWT not installed; cannot verify token")
    try:
        payload = jwt.decode(token, secret, algorithms=[algorithm])
    except Exception as exc:  # noqa: BLE001
        raise ValueError(f"invalid token: {exc}") from exc
    user_id = payload.get("sub") or payload.get("user_id")
    scopes_raw = payload.get("scopes") or ()
    if isinstance(scopes_raw, str):
        scopes = tuple(s.strip() for s in scopes_raw.split() if s.strip())
    else:
        scopes = tuple(scopes_raw)
    return AuthPrincipal(user_id=str(user_id) if user_id else None, scopes=scopes)
