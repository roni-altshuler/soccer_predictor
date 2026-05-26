"""Canonical entity identity (Phase 2)."""

from backend.pipeline.identity.resolver import (
    EntityKind,
    IdentityResolver,
    Resolution,
    get_identity_resolver,
)

__all__ = ["EntityKind", "IdentityResolver", "Resolution", "get_identity_resolver"]
