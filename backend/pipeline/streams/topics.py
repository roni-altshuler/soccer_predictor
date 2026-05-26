"""Redis Stream key constants.

A single source of truth so a typo in one consumer doesn't quietly listen to a
non-existent topic.
"""

# Live ingress streams — pollers and webhook receivers publish here
LIVE_EVENTS = "stream:live.events"          # goals, cards, subs, lineup changes
LIVE_SCORES = "stream:live.scores"          # score-only deltas (cheaper)

# Domain-event streams produced by workers
PREDICTIONS = "stream:predictions"          # recomputed probabilities
LINEUPS = "stream:lineups"
STANDINGS = "stream:standings"
TRANSFERS = "stream:transfers"
INJURIES = "stream:injuries"
ENTITY_UNRESOLVED = "stream:entity.unresolved"   # for the fuzzy-match queue

# Dead-letter
DLQ = "stream:dlq"

# WebSocket broadcast channel (pub/sub, not a stream — used for cross-instance
# fan-out by the gateway)
WS_BROADCAST = "ws:broadcast"

ALL_STREAMS = (
    LIVE_EVENTS,
    LIVE_SCORES,
    PREDICTIONS,
    LINEUPS,
    STANDINGS,
    TRANSFERS,
    INJURIES,
    ENTITY_UNRESOLVED,
    DLQ,
)
