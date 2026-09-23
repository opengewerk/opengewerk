-- Takes back the index that keeps a chain of documents from branching (#129).
--
-- The version before gets along without it: it made successors without
-- asking. The rows stay as they are, a document with one successor is a valid
-- chain for both versions.
DROP INDEX IF EXISTS "documents_one_successor";
