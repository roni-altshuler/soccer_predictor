"""Conservative event classification before requesting pre-match lineups."""


def _positive_id(value) -> bool:
    return (
        not isinstance(value, bool)
        and isinstance(value, (str, int))
        and str(value).isdecimal()
        and int(value) > 0
    )


def is_explicitly_postponed(event: dict) -> bool:
    """Require identified teams and agreeing event/competition postponement.

    A retained kickoff date does not make a postponed match upcoming. Unknown,
    malformed or contradictory context is not evidence for excluding a match;
    the caller's normal fetch and validation path must still handle it.
    """
    if not isinstance(event, dict) or not _positive_id(event.get("id")):
        return False
    competitions = event.get("competitions")
    if not isinstance(competitions, list) or len(competitions) != 1:
        return False
    competition = competitions[0]
    if not isinstance(competition, dict) or str(competition.get("id")) != str(
        event["id"]
    ):
        return False
    for container in (event, competition):
        status = container.get("status")
        kind = status.get("type") if isinstance(status, dict) else None
        if (
            not isinstance(kind, dict)
            or kind.get("name") != "STATUS_POSTPONED"
            or kind.get("state") != "post"
            or kind.get("completed") is not False
        ):
            return False
    competitors = competition.get("competitors")
    if not isinstance(competitors, list) or len(competitors) != 2:
        return False
    teams = {}
    for side in competitors:
        if not isinstance(side, dict):
            return False
        home_away, team = side.get("homeAway"), side.get("team")
        if (
            not isinstance(home_away, str)
            or home_away not in {"home", "away"}
            or home_away in teams
            or not isinstance(team, dict)
            or not _positive_id(team.get("id"))
        ):
            return False
        teams[home_away] = str(team["id"])
    return teams["home"] != teams["away"]
