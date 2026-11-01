import { peopleSchema, qualificationSchema } from '@opengewerk/platform-server'

/**
 * The files of the people who work for the business (#287), with the
 * working time agreed with each from a day on and their qualifications. The
 * tables are the foundation's (`peopleSchema`, `qualificationSchema`, ADR
 * 0012 and 0016) without columns of this application's own; the right that
 * reads them, the kinds of the catalogue and the deadline of a qualification
 * that runs out are this application's.
 */
export const { people, workingTimes } = peopleSchema()

export const { qualificationKinds, qualifications } = qualificationSchema({ people })
