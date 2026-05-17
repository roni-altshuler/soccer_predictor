'use client'

import { useEffect, useMemo, useState } from 'react'
import type { BracketRound, KnockoutMatch } from '@/components/knockout'

const BRACKET_CHALLENGE_STORAGE_KEY = 'fotpredict-bracket-challenge-v1'

type WinnerPick = 'home' | 'away'

type BracketChallengeEntry = {
  id: string
  userName: string
  createdAt: string
  updatedAt: string
  picks: Record<string, WinnerPick>
  source?: 'manual' | 'model'
  modelLabel?: string
  generatedPicks?: number
  averagePickConfidence?: number
}

type BracketChallengeGroup = {
  id: string
  tournamentId: string
  season: string
  name: string
  ownerName: string
  inviteCode: string
  createdAt: string
  scoring?: Record<string, number>
  entries: BracketChallengeEntry[]
}

type BracketChallengeBoardProps = {
  tournamentId: string
  tournamentName: string
  season: string
  rounds: BracketRound[]
  simulationData?: SimulationProbabilityData
}

type MatchWithRound = KnockoutMatch & {
  roundName: string
}

type TeamProbability = {
  team: string
  probability: number
}

type SimulationProbabilityData = {
  champion?: TeamProbability[]
  final?: TeamProbability[]
  semi_finals?: TeamProbability[]
  quarter_finals?: TeamProbability[]
  round_of_16?: TeamProbability[]
}

type ModelPickSummary = {
  picks: Record<string, WinnerPick>
  generatedPicks: number
  missingPicks: number
  averagePickConfidence: number
}

const ROUND_ORDER = ['Knockout Playoffs', 'Round of 16', 'Quarter-Finals', 'Semi-Finals', 'Third Place', 'Final']

const DEFAULT_ROUND_WEIGHTS: Record<string, number> = {
  'Knockout Playoffs': 1,
  'Round of 16': 1,
  'Quarter-Finals': 2,
  'Semi-Finals': 4,
  'Third Place': 1,
  Final: 8,
}

function normalizeRoundName(roundName: string): string {
  const value = roundName.toLowerCase()
  if (value.includes('playoff')) return 'Knockout Playoffs'
  if (value.includes('rd of 16')) return 'Round of 16'
  if (value.includes('round of 16')) return 'Round of 16'
  if (value.includes('quarter')) return 'Quarter-Finals'
  if (value.includes('semi')) return 'Semi-Finals'
  if (value.includes('third')) return 'Third Place'
  if (value.includes('final')) return 'Final'
  return roundName
}

function sanitizeScoring(scoring: unknown): Record<string, number> {
  if (!scoring || typeof scoring !== 'object') return {}

  return Object.entries(scoring as Record<string, unknown>).reduce<Record<string, number>>((acc, [roundName, value]) => {
    const normalizedRound = normalizeRoundName(roundName)
    if (!ROUND_ORDER.includes(normalizedRound)) return acc
    const numericValue = typeof value === 'number' ? value : Number(value)
    if (!Number.isFinite(numericValue)) return acc
    acc[normalizedRound] = Math.min(25, Math.max(0, Math.round(numericValue)))
    return acc
  }, {})
}

function getRoundWeight(roundName: string, scoring?: Record<string, number>): number {
  const normalized = normalizeRoundName(roundName)
  const customWeight = scoring?.[normalized]
  if (typeof customWeight === 'number' && Number.isFinite(customWeight)) return customWeight
  return DEFAULT_ROUND_WEIGHTS[normalized] || 1
}

function getGroupScoring(group: BracketChallengeGroup | null): Record<string, number> {
  return {
    ...DEFAULT_ROUND_WEIGHTS,
    ...sanitizeScoring(group?.scoring),
  }
}

function getMatchWinner(match: KnockoutMatch): WinnerPick | null {
  if (match.status !== 'finished') return null
  if (match.winner === 'home' || match.winner === 'away') return match.winner
  if (typeof match.homeScore !== 'number' || typeof match.awayScore !== 'number') return null
  if (match.homeScore > match.awayScore) return 'home'
  if (match.awayScore > match.homeScore) return 'away'
  if (typeof match.homePenalties === 'number' && typeof match.awayPenalties === 'number') {
    if (match.homePenalties > match.awayPenalties) return 'home'
    if (match.awayPenalties > match.homePenalties) return 'away'
  }
  return null
}

function normalizeTeamKey(team: string): string {
  return team
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function isKnownTeam(team?: string): team is string {
  return !!team && team.trim().length > 0 && team.trim().toLowerCase() !== 'tbd'
}

function probabilityRoundKey(roundName: string): keyof SimulationProbabilityData {
  const normalized = normalizeRoundName(roundName)
  if (normalized === 'Final') return 'champion'
  if (normalized === 'Semi-Finals') return 'final'
  if (normalized === 'Quarter-Finals') return 'semi_finals'
  if (normalized === 'Round of 16') return 'quarter_finals'
  return 'quarter_finals'
}

function findTeamProbability(rows: TeamProbability[] | undefined, team: string): number | null {
  if (!rows || rows.length === 0) return null
  const teamKey = normalizeTeamKey(team)
  const exact = rows.find((row) => normalizeTeamKey(row.team) === teamKey)
  if (exact) return exact.probability

  const partial = rows.find((row) => {
    const rowKey = normalizeTeamKey(row.team)
    return rowKey.includes(teamKey) || teamKey.includes(rowKey)
  })

  return partial?.probability ?? null
}

function getModelPick(match: MatchWithRound, simulationData?: SimulationProbabilityData): { pick: WinnerPick; confidence: number } | null {
  const lockedWinner = getMatchWinner(match)
  if (lockedWinner) return { pick: lockedWinner, confidence: 1 }
  if (!simulationData || !isKnownTeam(match.homeTeam) || !isKnownTeam(match.awayTeam)) return null

  const primaryKey = probabilityRoundKey(match.roundName)
  const fallbackKeys: Array<keyof SimulationProbabilityData> = [primaryKey, 'champion', 'final', 'semi_finals', 'quarter_finals']
  const uniqueKeys = Array.from(new Set(fallbackKeys))

  for (const key of uniqueKeys) {
    const homeProbability = findTeamProbability(simulationData[key], match.homeTeam)
    const awayProbability = findTeamProbability(simulationData[key], match.awayTeam)

    if (homeProbability === null || awayProbability === null || homeProbability === awayProbability) continue

    const pick = homeProbability > awayProbability ? 'home' : 'away'
    const confidence = Math.min(0.99, Math.max(0.5, Math.abs(homeProbability - awayProbability) + 0.5))
    return { pick, confidence }
  }

  return null
}

function buildModelPickSummary(matches: MatchWithRound[], simulationData?: SimulationProbabilityData): ModelPickSummary {
  const picks: Record<string, WinnerPick> = {}
  let confidenceTotal = 0
  let generatedPicks = 0

  for (const match of matches) {
    const modelPick = getModelPick(match, simulationData)
    if (!modelPick) continue
    picks[match.id] = modelPick.pick
    generatedPicks += 1
    confidenceTotal += modelPick.confidence
  }

  return {
    picks,
    generatedPicks,
    missingPicks: Math.max(0, matches.length - generatedPicks),
    averagePickConfidence: generatedPicks > 0 ? confidenceTotal / generatedPicks : 0,
  }
}

function buildInviteCode(): string {
  return Math.random().toString(36).slice(2, 8).toUpperCase()
}

function createId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function summarizeEntry(entry: BracketChallengeEntry, matches: MatchWithRound[], scoring?: Record<string, number>) {
  let score = 0
  let correct = 0
  let wrong = 0
  let pending = 0
  let completed = 0

  for (const match of matches) {
    const pick = entry.picks[match.id]
    const winner = getMatchWinner(match)
    if (!pick) continue
    if (!winner) {
      pending += 1
      continue
    }

    completed += 1
    if (pick === winner) {
      correct += 1
      score += getRoundWeight(match.roundName, scoring)
    } else {
      wrong += 1
    }
  }

  return { score, correct, wrong, pending, completed }
}

function copyToClipboard(value: string) {
  if (typeof navigator === 'undefined' || !navigator.clipboard) return Promise.reject(new Error('Clipboard unavailable'))
  return navigator.clipboard.writeText(value)
}

function parseChallengeGroupPayload(raw: string, fallbackTournamentId: string): BracketChallengeGroup {
  const parsed = JSON.parse(raw) as unknown
  const incoming = Array.isArray(parsed) ? parsed[0] : parsed
  if (!incoming || typeof incoming !== 'object') throw new Error('Invalid payload')

  const group = incoming as Partial<BracketChallengeGroup>
  if (
    typeof group.id !== 'string' ||
    typeof group.name !== 'string' ||
    typeof group.season !== 'string' ||
    !Array.isArray(group.entries)
  ) {
    throw new Error('Invalid payload')
  }

  return {
    id: group.id,
    tournamentId: group.tournamentId || fallbackTournamentId,
    season: group.season,
    name: group.name,
    ownerName: group.ownerName || 'Imported commissioner',
    inviteCode: group.inviteCode || buildInviteCode(),
    createdAt: group.createdAt || new Date().toISOString(),
    scoring: sanitizeScoring(group.scoring),
    entries: group.entries.filter((entry): entry is BracketChallengeEntry => {
      if (!entry || typeof entry !== 'object') return false
      const candidate = entry as Partial<BracketChallengeEntry>
      return typeof candidate.id === 'string' && typeof candidate.userName === 'string' && !!candidate.picks
    }),
  }
}

export default function BracketChallengeBoard({
  tournamentId,
  tournamentName,
  season,
  rounds,
  simulationData,
}: BracketChallengeBoardProps) {
  const [allGroups, setAllGroups] = useState<BracketChallengeGroup[]>([])
  const [activeGroupId, setActiveGroupId] = useState('')
  const [groupName, setGroupName] = useState('')
  const [ownerName, setOwnerName] = useState('')
  const [entryName, setEntryName] = useState('')
  const [editingEntryId, setEditingEntryId] = useState('')
  const [entryPicks, setEntryPicks] = useState<Record<string, WinnerPick>>({})
  const [importPayload, setImportPayload] = useState('')
  const [statusMessage, setStatusMessage] = useState('')

  const scopedGroups = useMemo(
    () => allGroups.filter((group) => group.tournamentId === tournamentId && group.season === season),
    [allGroups, tournamentId, season]
  )

  const activeGroup = scopedGroups.find((group) => group.id === activeGroupId) || scopedGroups[0] || null

  const matches = useMemo(
    () =>
      rounds.flatMap((round) =>
        round.matches.map((match) => ({
          ...match,
          roundName: round.name,
        }))
      ),
    [rounds]
  )

  const sortedRounds = useMemo(() => {
    return [...rounds].sort(
      (a, b) => {
        const aIdx = ROUND_ORDER.indexOf(normalizeRoundName(a.name))
        const bIdx = ROUND_ORDER.indexOf(normalizeRoundName(b.name))
        return (aIdx === -1 ? 99 : aIdx) - (bIdx === -1 ? 99 : bIdx)
      }
    )
  }, [rounds])

  const scoring = useMemo(() => getGroupScoring(activeGroup), [activeGroup])

  const roundNamesForScoring = useMemo(() => {
    const activeRoundNames = sortedRounds.map((round) => normalizeRoundName(round.name))
    const uniqueRoundNames = Array.from(new Set(activeRoundNames.length > 0 ? activeRoundNames : ROUND_ORDER))
    return uniqueRoundNames.sort((a, b) => {
      const aIdx = ROUND_ORDER.indexOf(a)
      const bIdx = ROUND_ORDER.indexOf(b)
      return (aIdx === -1 ? 99 : aIdx) - (bIdx === -1 ? 99 : bIdx)
    })
  }, [sortedRounds])

  const leaderboard = useMemo(() => {
    if (!activeGroup) return []
    return activeGroup.entries
      .map((entry) => ({
        entry,
        summary: summarizeEntry(entry, matches, scoring),
      }))
      .sort((a, b) => {
        if (b.summary.score !== a.summary.score) return b.summary.score - a.summary.score
        if (b.summary.correct !== a.summary.correct) return b.summary.correct - a.summary.correct
        return a.entry.userName.localeCompare(b.entry.userName)
      })
  }, [activeGroup, matches, scoring])

  const modelPickSummary = useMemo(
    () => buildModelPickSummary(matches, simulationData),
    [matches, simulationData]
  )

  useEffect(() => {
    try {
      const raw = localStorage.getItem(BRACKET_CHALLENGE_STORAGE_KEY)
      const parsed = raw ? JSON.parse(raw) as unknown : []
      const groups = Array.isArray(parsed)
        ? parsed.filter((item): item is BracketChallengeGroup => {
          if (!item || typeof item !== 'object') return false
          const group = item as Partial<BracketChallengeGroup>
          return typeof group.id === 'string' &&
            typeof group.name === 'string' &&
            typeof group.season === 'string' &&
            Array.isArray(group.entries)
        })
        : []

      const challengePayload = new URLSearchParams(window.location.search).get('challenge')
      if (challengePayload) {
        const importedGroup = parseChallengeGroupPayload(challengePayload, tournamentId)
        const nextGroups = [
          importedGroup,
          ...groups.filter((existing) => existing.id !== importedGroup.id),
        ]
        localStorage.setItem(BRACKET_CHALLENGE_STORAGE_KEY, JSON.stringify(nextGroups))
        setAllGroups(nextGroups)
        setActiveGroupId(importedGroup.id)
        setStatusMessage(`Imported challenge group "${importedGroup.name}" from invite link.`)

        const nextUrl = new URL(window.location.href)
        nextUrl.searchParams.delete('challenge')
        window.history.replaceState({}, '', nextUrl.toString())
        return
      }

      setAllGroups(groups)
    } catch {
      setAllGroups([])
    }
  }, [tournamentId])

  useEffect(() => {
    if (scopedGroups.length === 0) {
      setActiveGroupId('')
      return
    }
    if (!activeGroupId || !scopedGroups.some((group) => group.id === activeGroupId)) {
      setActiveGroupId(scopedGroups[0].id)
    }
  }, [activeGroupId, scopedGroups])

  const persistGroups = (nextGroups: BracketChallengeGroup[]) => {
    setAllGroups(nextGroups)
    localStorage.setItem(BRACKET_CHALLENGE_STORAGE_KEY, JSON.stringify(nextGroups))
  }

  const handleCreateGroup = () => {
    const trimmedGroup = groupName.trim()
    const trimmedOwner = ownerName.trim()
    if (!trimmedGroup || !trimmedOwner) {
      setStatusMessage('Enter a challenge name and commissioner name to create a group.')
      return
    }

    const group: BracketChallengeGroup = {
      id: createId('group'),
      tournamentId,
      season,
      name: trimmedGroup,
      ownerName: trimmedOwner,
      inviteCode: buildInviteCode(),
      createdAt: new Date().toISOString(),
      scoring: DEFAULT_ROUND_WEIGHTS,
      entries: [],
    }

    const nextGroups = [group, ...allGroups]
    persistGroups(nextGroups)
    setActiveGroupId(group.id)
    setGroupName('')
    setOwnerName('')
    setStatusMessage(`Challenge group "${group.name}" created.`)
  }

  const handleDeleteGroup = (groupId: string) => {
    const nextGroups = allGroups.filter((group) => group.id !== groupId)
    persistGroups(nextGroups)
    if (activeGroupId === groupId) {
      setActiveGroupId('')
      setEntryName('')
      setEditingEntryId('')
      setEntryPicks({})
    }
    setStatusMessage('Challenge group removed.')
  }

  const startEntryDraft = (entry?: BracketChallengeEntry) => {
    setEntryName(entry?.userName || '')
    setEditingEntryId(entry?.id || '')
    setEntryPicks(entry?.picks || {})
  }

  const clearEntryDraft = () => {
    setEntryName('')
    setEditingEntryId('')
    setEntryPicks({})
  }

  const handleSaveEntry = () => {
    if (!activeGroup) {
      setStatusMessage('Create or select a challenge group first.')
      return
    }

    const trimmedName = entryName.trim()
    if (!trimmedName) {
      setStatusMessage('Add an entry name before saving picks.')
      return
    }

    const nextEntry: BracketChallengeEntry = {
      id: editingEntryId || createId('entry'),
      userName: trimmedName,
      createdAt: activeGroup.entries.find((entry) => entry.id === editingEntryId)?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      picks: entryPicks,
      source: activeGroup.entries.find((entry) => entry.id === editingEntryId)?.source || 'manual',
    }

    const nextGroups = allGroups.map((group) => {
      if (group.id !== activeGroup.id) return group
      const otherEntries = group.entries.filter((entry) => entry.id !== nextEntry.id)
      return {
        ...group,
        entries: [...otherEntries, nextEntry].sort((a, b) => a.userName.localeCompare(b.userName)),
      }
    })

    persistGroups(nextGroups)
    setStatusMessage(`Saved picks for ${trimmedName}.`)
    clearEntryDraft()
  }

  const handleGenerateModelEntry = () => {
    if (modelPickSummary.generatedPicks === 0) {
      setStatusMessage('Run or load a tournament simulation before generating a model-backed bracket entry.')
      return
    }

    const now = new Date().toISOString()
    const targetGroup: BracketChallengeGroup = activeGroup || {
      id: createId('group'),
      tournamentId,
      season,
      name: `${tournamentName} AI Bracket Room`,
      ownerName: 'FotPredict AI',
      inviteCode: buildInviteCode(),
      createdAt: now,
      scoring: DEFAULT_ROUND_WEIGHTS,
      entries: [],
    }

    const existingModelEntry = targetGroup.entries.find((entry) => entry.source === 'model')
    const nextEntry: BracketChallengeEntry = {
      id: existingModelEntry?.id || createId('entry'),
      userName: 'FotPredict AI Bracket',
      createdAt: existingModelEntry?.createdAt || now,
      updatedAt: now,
      picks: modelPickSummary.picks,
      source: 'model',
      modelLabel: 'Simulation probability pick',
      generatedPicks: modelPickSummary.generatedPicks,
      averagePickConfidence: modelPickSummary.averagePickConfidence,
    }

    const baseGroups = activeGroup ? allGroups : [targetGroup, ...allGroups]
    const nextGroups = baseGroups.map((group) => {
      if (group.id !== targetGroup.id) return group
      const otherEntries = group.entries.filter((entry) => entry.id !== nextEntry.id)
      return {
        ...group,
        entries: [nextEntry, ...otherEntries].sort((a, b) => {
          if (a.source === 'model' && b.source !== 'model') return -1
          if (b.source === 'model' && a.source !== 'model') return 1
          return a.userName.localeCompare(b.userName)
        }),
      }
    })

    persistGroups(nextGroups)
    setActiveGroupId(targetGroup.id)
    setStatusMessage(
      `Generated an AI bracket entry with ${modelPickSummary.generatedPicks}/${matches.length} available picks.`
    )
    clearEntryDraft()
  }

  const handleDeleteEntry = (entryId: string) => {
    if (!activeGroup) return
    const nextGroups = allGroups.map((group) =>
      group.id === activeGroup.id
        ? { ...group, entries: group.entries.filter((entry) => entry.id !== entryId) }
        : group
    )
    persistGroups(nextGroups)
    if (editingEntryId === entryId) clearEntryDraft()
    setStatusMessage('Entry removed from the challenge.')
  }

  const handleImportGroup = () => {
    try {
      const importedGroup = parseChallengeGroupPayload(importPayload, tournamentId)

      const nextGroups = [
        importedGroup,
        ...allGroups.filter((existing) => existing.id !== importedGroup.id),
      ]
      persistGroups(nextGroups)
      setActiveGroupId(importedGroup.id)
      setImportPayload('')
      setStatusMessage(`Imported challenge group "${importedGroup.name}".`)
    } catch {
      setStatusMessage('Import failed. Paste a valid challenge JSON payload.')
    }
  }

  const exportActiveGroup = async () => {
    if (!activeGroup) return
    try {
      await copyToClipboard(JSON.stringify(activeGroup, null, 2))
      setStatusMessage(`Challenge group "${activeGroup.name}" copied to clipboard.`)
    } catch {
      setStatusMessage('Clipboard access failed. Copy the JSON manually from your browser if needed.')
    }
  }

  const copyInviteLink = async () => {
    if (!activeGroup || typeof window === 'undefined') return
    const url = new URL(window.location.href)
    url.searchParams.set('challenge', JSON.stringify(activeGroup))
    try {
      await copyToClipboard(url.toString())
      setStatusMessage(`Invite link for "${activeGroup.name}" copied to clipboard.`)
    } catch {
      setStatusMessage('Clipboard access failed while creating the invite link.')
    }
  }

  const handleScoringChange = (roundName: string, value: number) => {
    if (!activeGroup) return

    const normalizedRound = normalizeRoundName(roundName)
    const nextWeight = Math.min(25, Math.max(0, Math.round(value)))
    const nextGroups = allGroups.map((group) => (
      group.id === activeGroup.id
        ? {
          ...group,
          scoring: {
            ...getGroupScoring(group),
            [normalizedRound]: nextWeight,
          },
        }
        : group
    ))

    persistGroups(nextGroups)
    setStatusMessage(`Updated ${normalizedRound} scoring to ${nextWeight} point${nextWeight === 1 ? '' : 's'}.`)
  }

  return (
    <div className="space-y-6">
      <div className="bg-[var(--card-bg)] rounded-3xl border border-[var(--border-color)] overflow-hidden">
        <div className="border-b border-[var(--border-color)] bg-gradient-to-r from-[#42132d] via-[#641c3f] to-[#8a2f43] p-5 text-white">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-white/70">Bracket Challenge</p>
              <h2 className="mt-1 text-2xl font-black">{tournamentName} Pick&apos;em Groups</h2>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-white/80">
                Build a private knockout challenge, save bracket picks for multiple people, and watch the leaderboard move as real results settle.
              </p>
            </div>
            <div className="rounded-2xl bg-white/10 px-4 py-3 text-sm">
              <p className="font-bold">{season} knockout board</p>
              <p className="text-white/70">{matches.length} tracked matches across {sortedRounds.length} rounds</p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 p-5 xl:grid-cols-[0.9fr_1.1fr]">
          <div className="space-y-5">
            <div className="rounded-2xl border border-[var(--border-color)] bg-[var(--muted-bg)] p-4">
              <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--text-tertiary)]">Create Group</p>
              <div className="mt-3 grid gap-3">
                <input
                  value={groupName}
                  onChange={(event) => setGroupName(event.target.value)}
                  placeholder="Road to the Final"
                  className="rounded-xl border border-[var(--border-color)] bg-[var(--background-secondary)] px-3 py-2 text-sm text-[var(--text-primary)]"
                />
                <input
                  value={ownerName}
                  onChange={(event) => setOwnerName(event.target.value)}
                  placeholder="Commissioner name"
                  className="rounded-xl border border-[var(--border-color)] bg-[var(--background-secondary)] px-3 py-2 text-sm text-[var(--text-primary)]"
                />
                <button
                  onClick={handleCreateGroup}
                  className="rounded-xl bg-[var(--accent-primary)] px-4 py-2 text-sm font-bold text-[#04120a] transition-opacity hover:opacity-95"
                >
                  Create Challenge Group
                </button>
              </div>
            </div>

            <div className="rounded-2xl border border-[var(--border-color)] bg-[var(--muted-bg)] p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--text-tertiary)]">Challenge Groups</p>
                  <h3 className="mt-1 text-base font-bold text-[var(--text-primary)]">{scopedGroups.length} active group{scopedGroups.length === 1 ? '' : 's'}</h3>
                </div>
              </div>
              <div className="mt-3 space-y-2">
                {scopedGroups.length > 0 ? (
                  scopedGroups.map((group) => (
                    <div
                      key={group.id}
                      className={`rounded-xl border p-3 transition-colors ${
                        activeGroup?.id === group.id
                          ? 'border-[var(--accent-primary)] bg-[var(--card-bg)]'
                          : 'border-[var(--border-color)] bg-[var(--background-secondary)]'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <button onClick={() => setActiveGroupId(group.id)} className="min-w-0 flex-1 text-left">
                          <p className="truncate text-sm font-bold text-[var(--text-primary)]">{group.name}</p>
                          <p className="mt-1 text-xs text-[var(--text-secondary)]">
                            {group.entries.length} entries · Commissioner: {group.ownerName}
                          </p>
                          <p className="mt-1 text-[10px] font-bold uppercase tracking-[0.14em] text-amber-400">
                            Invite code {group.inviteCode}
                          </p>
                        </button>
                        <button
                          onClick={() => handleDeleteGroup(group.id)}
                          className="rounded-lg border border-[var(--border-color)] px-2 py-1 text-[10px] font-bold text-[var(--text-tertiary)] hover:border-red-400 hover:text-red-400"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="rounded-xl border border-dashed border-[var(--border-color)] px-3 py-5 text-sm text-[var(--text-secondary)]">
                    No challenge groups yet for this tournament season.
                  </p>
                )}
              </div>
            </div>

            <div className="rounded-2xl border border-[var(--border-color)] bg-[var(--muted-bg)] p-4">
              <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--text-tertiary)]">AI Bracket</p>
              <h3 className="mt-1 text-base font-bold text-[var(--text-primary)]">Model-backed personal entry</h3>
              <p className="mt-2 text-xs leading-5 text-[var(--text-secondary)]">
                Generate a FotPredict entry from the current simulation probability table. Locked real results are kept, and unknown matchups stay unpicked.
              </p>
              <div className="mt-3 grid grid-cols-3 gap-2">
                <div className="rounded-xl bg-[var(--background-secondary)] p-3">
                  <p className="text-[10px] uppercase tracking-[0.12em] text-[var(--text-tertiary)]">Available</p>
                  <p className="mt-1 text-lg font-black text-[var(--text-primary)]">{modelPickSummary.generatedPicks}</p>
                </div>
                <div className="rounded-xl bg-[var(--background-secondary)] p-3">
                  <p className="text-[10px] uppercase tracking-[0.12em] text-[var(--text-tertiary)]">Open</p>
                  <p className="mt-1 text-lg font-black text-[var(--text-primary)]">{modelPickSummary.missingPicks}</p>
                </div>
                <div className="rounded-xl bg-[var(--background-secondary)] p-3">
                  <p className="text-[10px] uppercase tracking-[0.12em] text-[var(--text-tertiary)]">Avg Lean</p>
                  <p className="mt-1 text-lg font-black text-[var(--text-primary)]">
                    {modelPickSummary.generatedPicks > 0 ? `${Math.round(modelPickSummary.averagePickConfidence * 100)}%` : 'N/A'}
                  </p>
                </div>
              </div>
              <button
                onClick={handleGenerateModelEntry}
                disabled={modelPickSummary.generatedPicks === 0}
                className="mt-3 w-full rounded-xl bg-[var(--accent-primary)] px-4 py-2 text-sm font-bold text-[#04120a] transition-opacity hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Generate AI Bracket Entry
              </button>
            </div>

            <div className="rounded-2xl border border-[var(--border-color)] bg-[var(--muted-bg)] p-4">
              <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--text-tertiary)]">Import / Export</p>
              <p className="mt-2 text-xs leading-5 text-[var(--text-secondary)]">
                This release is local-first. Share an invite link or export a challenge group JSON payload to continue the competition on another device or browser.
              </p>
              <div className="mt-3 grid gap-3">
                <textarea
                  value={importPayload}
                  onChange={(event) => setImportPayload(event.target.value)}
                  placeholder='Paste a challenge JSON payload here'
                  rows={5}
                  className="rounded-xl border border-[var(--border-color)] bg-[var(--background-secondary)] px-3 py-2 text-sm text-[var(--text-primary)]"
                />
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={handleImportGroup}
                    className="rounded-xl border border-[var(--border-color)] px-4 py-2 text-sm font-bold text-[var(--text-primary)] hover:border-[var(--accent-primary)]"
                  >
                    Import Group
                  </button>
                  <button
                    onClick={exportActiveGroup}
                    disabled={!activeGroup}
                    className="rounded-xl border border-[var(--border-color)] px-4 py-2 text-sm font-bold text-[var(--text-primary)] hover:border-[var(--accent-primary)] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Copy Active Group JSON
                  </button>
                  <button
                    onClick={copyInviteLink}
                    disabled={!activeGroup}
                    className="rounded-xl border border-[var(--border-color)] px-4 py-2 text-sm font-bold text-[var(--text-primary)] hover:border-[var(--accent-primary)] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Copy Invite Link
                  </button>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-[var(--border-color)] bg-[var(--muted-bg)] p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--text-tertiary)]">Scoring Rules</p>
                  <h3 className="mt-1 text-base font-bold text-[var(--text-primary)]">Commissioner point weights</h3>
                </div>
              </div>
              <div className="mt-3 grid gap-2">
                {roundNamesForScoring.map((roundName) => (
                  <label
                    key={roundName}
                    className="grid grid-cols-[1fr_88px] items-center gap-3 rounded-xl border border-[var(--border-color)] bg-[var(--background-secondary)] px-3 py-2"
                  >
                    <span className="text-sm font-bold text-[var(--text-primary)]">{roundName}</span>
                    <input
                      type="number"
                      min={0}
                      max={25}
                      value={scoring[roundName] ?? getRoundWeight(roundName)}
                      onChange={(event) => handleScoringChange(roundName, Number(event.target.value))}
                      disabled={!activeGroup}
                      className="rounded-lg border border-[var(--border-color)] bg-[var(--card-bg)] px-2 py-1 text-right text-sm font-bold text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-50"
                    />
                  </label>
                ))}
              </div>
              <p className="mt-3 text-xs leading-5 text-[var(--text-secondary)]">
                Higher weights make late-round picks matter more. Settings are saved with exported groups and invite links.
              </p>
            </div>

            {statusMessage && (
              <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
                {statusMessage}
              </div>
            )}
          </div>

          <div className="space-y-5">
            <div className="rounded-2xl border border-[var(--border-color)] bg-[var(--muted-bg)] p-4">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--text-tertiary)]">Leaderboard</p>
                  <h3 className="mt-1 text-lg font-bold text-[var(--text-primary)]">{activeGroup?.name || 'Select a group'}</h3>
                </div>
                {activeGroup && (
                  <div className="rounded-xl border border-[var(--border-color)] bg-[var(--background-secondary)] px-3 py-2 text-xs text-[var(--text-secondary)]">
                    Invite code <span className="font-bold text-amber-400">{activeGroup.inviteCode}</span>
                  </div>
                )}
              </div>

              <div className="mt-4 space-y-2">
                {leaderboard.length > 0 ? (
                  leaderboard.map(({ entry, summary }, index) => (
                    <div key={entry.id} className="rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-bold text-[var(--text-primary)]">
                            {index + 1}. {entry.userName}
                          </p>
                          {entry.source === 'model' && (
                            <p className="mt-1 text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--accent-ai)]">
                              AI-generated · {entry.generatedPicks || Object.keys(entry.picks).length} picks
                              {entry.averagePickConfidence ? ` · ${Math.round(entry.averagePickConfidence * 100)}% avg lean` : ''}
                            </p>
                          )}
                          <p className="mt-1 text-xs text-[var(--text-secondary)]">
                            {summary.correct} correct · {summary.wrong} wrong · {summary.pending} pending
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-lg font-black text-amber-400">{summary.score}</p>
                          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--text-tertiary)]">points</p>
                        </div>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          onClick={() => startEntryDraft(entry)}
                          className="rounded-lg border border-[var(--border-color)] px-3 py-1.5 text-[11px] font-bold text-[var(--text-primary)] hover:border-[var(--accent-primary)]"
                        >
                          Edit Picks
                        </button>
                        <button
                          onClick={() => handleDeleteEntry(entry.id)}
                          className="rounded-lg border border-[var(--border-color)] px-3 py-1.5 text-[11px] font-bold text-[var(--text-tertiary)] hover:border-red-400 hover:text-red-400"
                        >
                          Remove Entry
                        </button>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="rounded-xl border border-dashed border-[var(--border-color)] px-3 py-5 text-sm text-[var(--text-secondary)]">
                    Add at least one entry to start the challenge leaderboard.
                  </p>
                )}
              </div>
            </div>

            <div className="rounded-2xl border border-[var(--border-color)] bg-[var(--muted-bg)] p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--text-tertiary)]">Entry Builder</p>
                  <h3 className="mt-1 text-lg font-bold text-[var(--text-primary)]">
                    {editingEntryId ? 'Edit bracket entry' : 'Create a bracket entry'}
                  </h3>
                </div>
                {editingEntryId && (
                  <button
                    onClick={clearEntryDraft}
                    className="rounded-lg border border-[var(--border-color)] px-3 py-1.5 text-[11px] font-bold text-[var(--text-secondary)] hover:border-[var(--accent-primary)]"
                  >
                    Clear Draft
                  </button>
                )}
              </div>

              <div className="mt-4">
                <input
                  value={entryName}
                  onChange={(event) => setEntryName(event.target.value)}
                  placeholder="Entry name"
                  className="w-full rounded-xl border border-[var(--border-color)] bg-[var(--background-secondary)] px-3 py-2 text-sm text-[var(--text-primary)]"
                />
              </div>

              <div className="mt-4 space-y-4">
                {sortedRounds.length > 0 ? (
                  sortedRounds.map((round) => (
                    <div key={round.name} className="rounded-2xl border border-[var(--border-color)] bg-[var(--card-bg)] p-4">
                      <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--text-tertiary)]">
                        {normalizeRoundName(round.name)} · {getRoundWeight(round.name, scoring)} point{getRoundWeight(round.name, scoring) === 1 ? '' : 's'} each
                      </p>
                      <div className="mt-3 space-y-3">
                        {round.matches.map((match) => {
                          const selectedWinner = entryPicks[match.id]
                          const actualWinner = getMatchWinner(match)
                          return (
                            <div key={match.id} className="rounded-xl border border-[var(--border-color)] bg-[var(--background-secondary)] p-3">
                              <div className="flex items-center justify-between gap-3">
                                <p className="text-xs text-[var(--text-secondary)]">
                                  {match.date || 'TBD'}{match.time ? ` · ${match.time}` : ''}
                                </p>
                                {actualWinner && (
                                  <span className="rounded-full bg-emerald-500/15 px-2 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-emerald-300">
                                    Result locked
                                  </span>
                                )}
                              </div>
                              <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                                <button
                                  onClick={() => setEntryPicks((current) => ({ ...current, [match.id]: 'home' }))}
                                  disabled={!match.homeTeam || match.homeTeam === 'TBD'}
                                  className={`rounded-xl border px-3 py-3 text-left transition-colors ${
                                    selectedWinner === 'home'
                                      ? 'border-[var(--accent-primary)] bg-[var(--accent-primary)]/12'
                                      : 'border-[var(--border-color)] bg-[var(--card-bg)]'
                                  }`}
                                >
                                  <p className="text-sm font-bold text-[var(--text-primary)]">{match.homeTeam || 'TBD'}</p>
                                  <p className="mt-1 text-xs text-[var(--text-secondary)]">Home side</p>
                                </button>
                                <button
                                  onClick={() => setEntryPicks((current) => ({ ...current, [match.id]: 'away' }))}
                                  disabled={!match.awayTeam || match.awayTeam === 'TBD'}
                                  className={`rounded-xl border px-3 py-3 text-left transition-colors ${
                                    selectedWinner === 'away'
                                      ? 'border-[var(--accent-primary)] bg-[var(--accent-primary)]/12'
                                      : 'border-[var(--border-color)] bg-[var(--card-bg)]'
                                  }`}
                                >
                                  <p className="text-sm font-bold text-[var(--text-primary)]">{match.awayTeam || 'TBD'}</p>
                                  <p className="mt-1 text-xs text-[var(--text-secondary)]">Away side</p>
                                </button>
                              </div>
                              {actualWinner && (
                                <p className="mt-3 text-xs text-[var(--text-secondary)]">
                                  Actual winner: <span className="font-bold text-[var(--text-primary)]">{actualWinner === 'home' ? match.homeTeam : match.awayTeam}</span>
                                </p>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="rounded-2xl border border-dashed border-[var(--border-color)] px-4 py-8 text-sm text-[var(--text-secondary)]">
                    The bracket challenge unlocks when knockout fixtures are available from the provider feed.
                  </div>
                )}
              </div>

              <div className="mt-5 flex flex-wrap gap-2">
                <button
                  onClick={handleSaveEntry}
                  disabled={!activeGroup}
                  className="rounded-xl bg-[var(--accent-primary)] px-4 py-2 text-sm font-bold text-[#04120a] transition-opacity hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Save Entry
                </button>
                {!activeGroup && (
                  <p className="self-center text-xs text-[var(--text-secondary)]">
                    Create a challenge group before saving bracket picks.
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
