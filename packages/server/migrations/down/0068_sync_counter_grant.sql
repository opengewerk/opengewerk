-- Back to how 0004 left the function: without a word about who may call it,
-- and so open to every role.
GRANT EXECUTE ON FUNCTION "next_sync_sequence"(uuid) TO PUBLIC;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION "next_sync_sequence"(uuid) FROM "opengewerk_app";
