-- A second number for a contact, mostly the mobile one
-- (opengewerk-haustechnik#428): somebody with a line and an extension has a
-- mobile as well. The column is the foundation's (`contactsSchema`); every
-- application adds it with a migration of its own. Rows of before have none.
ALTER TABLE "contacts" ADD COLUMN "mobile" text;
