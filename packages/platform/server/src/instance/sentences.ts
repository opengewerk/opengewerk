/**
 * The sentences of the area of the instance that name whoever runs it, a
 * tenant, or who leads one, in the words of the application.
 *
 * Whoever runs an instance has a different name in every application, and so
 * has a tenant: what one calls the operator of an instance is what another
 * calls its tenants. A word set into a sentence of the foundation would be
 * wrong in one of them, so each sentence comes whole, as the application
 * writes it. Everything else the area says is the same everywhere and stands
 * where it is said.
 */
export interface InstanceSentences {
  /** The account named to run the instance already does. */
  readonly alreadyOperator: string
  /** The account the instance is to be taken away from does not run it. */
  readonly notAnOperator: string
  /** Nobody takes the instance away from themselves; somebody else does. */
  readonly notOneself: string
  /** The last one who runs the instance stays. */
  readonly lastOperator: string
  /** A tenant to be created came without anything that could be a name. */
  readonly tenantNameMissing: string
  /** A tenant for somebody else, and the name of who is to lead it is missing. */
  readonly leadNameMissing: string
  /** A tenant for somebody else, and the address of who is to lead it is not one. */
  readonly leadEmailNotOne: string
  /** What the command that names somebody to run the instance says on the terminal. */
  readonly appointOperator: {
    /** How it is called, and what comes of it: the whole of its help. */
    readonly usage: string
    appointed(email: string): string
    /** Said after it, when the account has no second factor yet. */
    readonly secondFactor: string
    /** What stands in front of a failure nobody wrote a sentence for. */
    readonly failed: string
  }
  /** What the command that creates a tenant with whoever leads it says on the terminal. */
  readonly addTenant: {
    /** How it is called, the first line of its help. */
    readonly usage: string
    /** The tenant is there, led by an account that came into being with the command. */
    createdWithAccount(name: string, tenantId: string, email: string): string
    /** The tenant is there, led by an account that was on the instance already. */
    createdForAccount(name: string, tenantId: string, email: string): string
    /** Said after either, when the role that leads needs a second factor. */
    readonly secondFactor: string
    /** What stands in front of a failure nobody wrote a sentence for. */
    readonly failed: string
  }
}
