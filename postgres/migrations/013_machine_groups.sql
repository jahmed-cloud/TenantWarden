-- ─── 013: machine groups ────────────────────────────────────────────────────
-- Groups are set in the portal (Agents → select hosts → Add to group). They are separate from
-- agents.tags, which come from the agent's own config and are rewritten on every registration.
ALTER TABLE agents ADD COLUMN IF NOT EXISTS groups TEXT[] NOT NULL DEFAULT '{}';
CREATE INDEX IF NOT EXISTS idx_agents_groups ON agents USING GIN (groups);
