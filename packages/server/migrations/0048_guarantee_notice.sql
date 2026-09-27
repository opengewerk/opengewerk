-- The harmonised notice on the legal guarantee as a fifth shipped instruction, #431.
--
-- The line below comes from the schema. Since 27.09.2026 a quote to a consumer
-- about goods carries the notice of annex I to Implementing Regulation (EU)
-- 2025/1960. A value added to an enum may not be used in the transaction that
-- adds it, and all pending migrations run in one; nothing here touches it, and
-- the rows for it are written by the server the first time a business asks,
-- like every shipped instruction.

ALTER TYPE "public"."instruction_template" ADD VALUE 'guarantee_notice';