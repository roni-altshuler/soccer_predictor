"""
JWT token utilities for authentication.
"""

import os
from datetime import datetime, timedelta
from typing import Optional, Dict, Any
import logging

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

# For JWT encoding/decoding, we'll use a simple approach
# that doesn't require external dependencies
import hashlib
import hmac
import base64
import json

logger = logging.getLogger(__name__)

def _resolve_secret_key() -> str:
    """Resolve the JWT signing secret.

    Production refuses to start without an explicit JWT_SECRET_KEY;
    development falls back to an ephemeral per-process secret so tokens
    never validate against a publicly known string.
    """
    configured = os.getenv("JWT_SECRET_KEY")
    if configured:
        return configured
    if os.getenv("ENVIRONMENT", "development").lower() == "production":
        raise RuntimeError("JWT_SECRET_KEY must be set when ENVIRONMENT=production")
    import secrets

    logger.warning(
        "JWT_SECRET_KEY not set — using an ephemeral secret; "
        "issued tokens will not survive a process restart."
    )
    return secrets.token_urlsafe(64)


# Security configuration
SECRET_KEY = _resolve_secret_key()
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 30
REFRESH_TOKEN_EXPIRE_DAYS = 7

# Security scheme
security = HTTPBearer(auto_error=False)


def _base64url_encode(data: bytes) -> str:
    """Base64 URL-safe encode."""
    return base64.urlsafe_b64encode(data).rstrip(b'=').decode('utf-8')


def _base64url_decode(data: str) -> bytes:
    """Base64 URL-safe decode."""
    padding = 4 - len(data) % 4
    if padding != 4:
        data += '=' * padding
    return base64.urlsafe_b64decode(data)


def _create_signature(message: str, secret: str) -> str:
    """Create HMAC-SHA256 signature."""
    key = secret.encode('utf-8')
    msg = message.encode('utf-8')
    signature = hmac.new(key, msg, hashlib.sha256).digest()
    return _base64url_encode(signature)


def create_token(payload: Dict[str, Any], expires_delta: timedelta) -> str:
    """
    Create a JWT token.
    
    Args:
        payload: Token payload data
        expires_delta: Token expiration time
    
    Returns:
        Encoded JWT token string
    """
    # Create header
    header = {"alg": ALGORITHM, "typ": "JWT"}
    
    # Add expiration to payload
    expire = datetime.utcnow() + expires_delta
    payload_with_exp = {
        **payload,
        "exp": expire.timestamp(),
        "iat": datetime.utcnow().timestamp(),
    }
    
    # Encode header and payload
    header_encoded = _base64url_encode(json.dumps(header).encode('utf-8'))
    payload_encoded = _base64url_encode(json.dumps(payload_with_exp).encode('utf-8'))
    
    # Create signature
    message = f"{header_encoded}.{payload_encoded}"
    signature = _create_signature(message, SECRET_KEY)
    
    return f"{header_encoded}.{payload_encoded}.{signature}"


def verify_token(token: str) -> Optional[Dict[str, Any]]:
    """
    Verify and decode a JWT token.
    
    Args:
        token: JWT token string
    
    Returns:
        Decoded payload if valid, None otherwise
    """
    try:
        parts = token.split('.')
        if len(parts) != 3:
            return None
        
        header_encoded, payload_encoded, signature = parts
        
        # Verify signature
        message = f"{header_encoded}.{payload_encoded}"
        expected_signature = _create_signature(message, SECRET_KEY)
        
        if not hmac.compare_digest(signature, expected_signature):
            logger.warning("Invalid token signature")
            return None
        
        # Decode payload
        payload_json = _base64url_decode(payload_encoded)
        payload = json.loads(payload_json)
        
        # Check expiration
        exp = payload.get("exp")
        if exp and datetime.utcnow().timestamp() > exp:
            logger.warning("Token expired")
            return None
        
        return payload
        
    except Exception as e:
        logger.error(f"Token verification error: {e}")
        return None


def create_access_token(user_id: str, email: str) -> str:
    """Create an access token for a user."""
    payload = {
        "sub": user_id,
        "email": email,
        "type": "access",
    }
    return create_token(payload, timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES))


def create_refresh_token(user_id: str, email: str) -> str:
    """Create a refresh token for a user."""
    payload = {
        "sub": user_id,
        "email": email,
        "type": "refresh",
    }
    return create_token(payload, timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS))


async def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security)
) -> Optional[Dict[str, Any]]:
    """
    FastAPI dependency to get the current authenticated user.
    
    Returns None if no valid token is provided.
    Raises HTTPException for invalid tokens.
    """
    if not credentials:
        return None
    
    token = credentials.credentials
    payload = verify_token(token)
    
    if not payload:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    if payload.get("type") != "access":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token type",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    return payload


def require_auth(
    credentials: HTTPAuthorizationCredentials = Depends(security)
) -> Dict[str, Any]:
    """
    FastAPI dependency that requires authentication.
    
    Raises HTTPException if not authenticated.
    """
    if not credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    token = credentials.credentials
    payload = verify_token(token)
    
    if not payload:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    return payload
