/**
 * How long a one time link into a tenant is good for.
 *
 * Long enough to survive a weekend and a forgotten message, short enough that
 * a link in an old chat is not a way in months later. Days rather than hours
 * because these are handed over by hand, sometimes on paper, and an expiry
 * that runs out before the person is back at a desk is a link that gets
 * reissued until somebody stops bothering with the expiry.
 */
export const invitationDays = 7
