// The interface of the foundation (ADR 0010): what every application of the
// organisation shows before its first screen of its own, and what it builds
// its screens from. No customer and no document, no property and no
// obligation, and no name of a product: an application brings those and hands
// them in where something here needs a word or a list.
//
// Taken as source. An application compiles this package together with its
// own screens, with the same compiler and the same options, so there is no
// build step in between and nothing to rebuild after a change here.

// The components every screen is built from, with the two entry points they
// know: the office, with a mouse, and the site, with a finger.
export * from './components/index.js'
