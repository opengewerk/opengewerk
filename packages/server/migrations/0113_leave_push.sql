-- Push on leave (#806, Feature-Gliederung v2.49): a request goes to whoever
-- keeps absences, the decision to whoever asked. The two occasions come into
-- `push_kind` before the test message of the foundation, where the list in the
-- code has them.
--
-- **Fits the version before it**: an unused value of an enum asks for nothing.
ALTER TYPE "public"."push_kind" ADD VALUE 'leave_request' BEFORE 'test';--> statement-breakpoint
ALTER TYPE "public"."push_kind" ADD VALUE 'leave_decision' BEFORE 'test';