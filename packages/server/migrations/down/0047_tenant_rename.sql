-- Back to how 0007 left the table: the application role reads its business
-- and changes nothing about it. A name changed since stays as it is.
REVOKE UPDATE ("name", "updated_at") ON "tenants" FROM "opengewerk_app";
