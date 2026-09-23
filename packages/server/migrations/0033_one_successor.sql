-- A chain of documents does not branch: #129.
--
-- The index at the end comes from the schema, the check before it is written
-- by hand.
--
-- Until now any number of successors could be made out of one issued
-- document. A progress invoice out of the quote and then the final invoice out
-- of the quote as well, not out of the progress invoice: the final invoice's
-- chain is only the quote, it deducts nothing, and it bills the whole amount a
-- second time. The deductions follow a document's own chain upwards and never
-- sideways. From here on a document has at most one successor that continues
-- it, and the next is made out of the last link. What does not count is what
-- has left the chain, as `continuesChain` in `domain` says: a deleted draft, a
-- cancelled invoice, and the two corrections, which name the invoice they
-- correct without being a link after it. The route that makes a successor
-- asks first and says which document the chain goes on at; this index is the
-- same rule for every other way in.
--
-- **Nothing is moved.** A document that already has two successors that count
-- would make the index fail with a sentence about a key. The check below looks
-- first and stops the update with the number of such documents instead, and
-- since every pending migration runs in one transaction, the database stays as
-- it was. Which they are, this shows, run as the superuser the backup uses:
--
--   select predecessor_document_id, array_agg(id) from documents
--    where predecessor_document_id is not null and deleted_at is null
--      and status <> 'cancelled' and kind not in ('cancellation_invoice', 'credit_note')
--    group by tenant_id, predecessor_document_id having count(*) > 1;
--
-- Which of them stays is a person's decision: one of the others is cancelled,
-- or deleted while it is still a draft.
--
-- **The check has to see the rows.** Migrations run as the owner, `documents`
-- stands on FORCE ROW LEVEL SECURITY and no policy names the owner, so a plain
-- count finds nothing. FORCE is switched off for the length of the count,
-- inside the transaction, and back on before the decision, as in 0031.
DO $$
DECLARE
	branched bigint;
BEGIN
	ALTER TABLE documents NO FORCE ROW LEVEL SECURITY;

	SELECT count(*) INTO branched FROM (
		SELECT 1
		  FROM documents
		 WHERE predecessor_document_id IS NOT NULL
		   AND deleted_at IS NULL
		   AND status <> 'cancelled'
		   AND kind NOT IN ('cancellation_invoice', 'credit_note')
		 GROUP BY tenant_id, predecessor_document_id
		HAVING count(*) > 1
	) AS forks;

	ALTER TABLE documents FORCE ROW LEVEL SECURITY;

	IF branched > 0 THEN
		RAISE EXCEPTION 'Aus % ist schon mehr als ein Folgebeleg entstanden, der gilt. Eine Belegkette verzweigt sich ab dieser Fassung nicht mehr, damit keine Rechnung ein zweites Mal stellt, was eine andere schon gestellt hat. Das Update legt dafür nichts um und bricht ab, die Datenbank bleibt auf dem Stand davor. Welche Belege es sind, zeigt die Abfrage aus Migration 0033; von den überzähligen Folgebelegen einen stornieren oder, solange er ein Entwurf ist, löschen, dann erneut starten.',
			CASE WHEN branched = 1 THEN 'einem Beleg' ELSE branched || ' Belegen' END;
	END IF;
END
$$;--> statement-breakpoint
CREATE UNIQUE INDEX "documents_one_successor" ON "documents" USING btree ("tenant_id","predecessor_document_id") WHERE "documents"."predecessor_document_id" is not null
          and "documents"."deleted_at" is null
          and "documents"."status" <> 'cancelled'
          and "documents"."kind" not in ('cancellation_invoice', 'credit_note');
