/**
 * "Why this prediction" attribution payloads.
 *
 * One feature's contribution to the served pick, in logit units.
 * Positive pushes TOWARD the predicted outcome, negative against it.
 * Dense features come from integrated gradients; grouped categorical
 * identities (e.g. `home_team_identity`) from embedding occlusion.
 * Mirrors `AttributionItem` in `backend/models/prediction.py`.
 */
export interface AttributionItem {
  feature: string
  value: number
  contribution: number
}
