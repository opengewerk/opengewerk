-- The device can say what a document should be called and what it is about.
-- It cannot say that the document is issued, what number it carries or when
-- that happened: those three are one act, and the act needs the counter, the
-- server clock and a right the device may not have. Refusing them needs a
-- reason a device can name before it sends, hence the new value.
ALTER TYPE "public"."conflict_reason" ADD VALUE 'set_by_server';
