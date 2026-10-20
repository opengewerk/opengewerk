-- A conflict belongs to the person whose change it was as well as to the
-- device it came from (found in the security review,
-- opengewerk-haustechnik#360). Until now the list and closing a conflict asked
-- for the device alone, and on a device passed from hand to hand the next
-- person saw the conflicts of the one before. From now on the server writes
-- the person of the session into every new conflict and lists and closes by
-- both. The column is the foundation's (`sync_conflicts.user_id`); every
-- application adds it with a migration of its own.
--
-- **Whom the conflicts of before get.** The table kept no person, and neither
-- does the receipt of the operation. What tells is the stretch of work in the
-- business (`tenant_sessions`): a session chosen with this device that had
-- begun when the conflict came and had not ended before it. Where exactly one
-- person had such a stretch, the conflict is theirs. Where several had, a
-- device shared while somebody did not sign out, or none had, a transmission
-- from a desk whose session names no device, nobody can be told; the conflict
-- keeps no person and is shown to nobody. It stays as it is, open, since
-- nobody decided it.
--
-- Row level security is lifted on both tables for the statement, because as
-- the owner under FORCE it would find no row and say nothing.
ALTER TABLE "sync_conflicts" ADD COLUMN "user_id" text;--> statement-breakpoint
ALTER TABLE "sync_conflicts" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tenant_sessions" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
UPDATE "sync_conflicts" AS "conflict" SET "user_id" = "told"."user_id"
	FROM (
		SELECT "c"."id", min("s"."user_id") AS "user_id"
		FROM "sync_conflicts" AS "c"
		JOIN "tenant_sessions" AS "s"
			ON "s"."tenant_id" = "c"."tenant_id"
			AND "s"."device_id" = "c"."device_id"
			AND "s"."started_at" <= "c"."created_at"
			AND ("s"."ended_at" IS NULL OR "s"."ended_at" >= "c"."created_at")
		GROUP BY "c"."id"
		HAVING count(DISTINCT "s"."user_id") = 1
	) AS "told"
	WHERE "told"."id" = "conflict"."id";--> statement-breakpoint
ALTER TABLE "tenant_sessions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sync_conflicts" FORCE ROW LEVEL SECURITY;
