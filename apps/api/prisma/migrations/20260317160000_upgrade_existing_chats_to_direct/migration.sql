-- Upgrade existing active_sandbox matches to wall_broken (direct chat)
-- This is needed because the relay/转述 feature was added after these matches
-- already had real conversations going on.
UPDATE "matches"
SET "status" = 'wall_broken',
    "resonance_score" = GREATEST("resonance_score", 100)
WHERE "status" = 'active_sandbox';
