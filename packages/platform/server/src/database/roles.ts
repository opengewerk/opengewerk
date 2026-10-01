// The two roles of the database, by name. They are called the same in every
// application of the organisation (ADR 0010, point 10): each application has a
// PostgreSQL of its own, and roles only meet inside one cluster.

/** The role that owns the tables and runs the migrations. */
export const migrationRole = 'opengewerk_owner'

/** The role the application connects as, the one the policies are written for. */
export const applicationRoleName = 'opengewerk_app'
