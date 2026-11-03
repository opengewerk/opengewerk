import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { checkBudgets } from '@opengewerk/platform-web/tools/budget'

/**
 * The budgets of this application's two entry points, measured by the
 * foundation's tool against the build (ADR 0004, ADR 0010).
 *
 * The site figure is the one from ADR 0004. The office figure is not in any
 * ADR: it is a ceiling that catches a careless import, generous because the
 * office sits at a desk on a cable. If it ever has to be raised, that is a
 * decision worth a sentence in the pull request, which is the whole point of
 * having it.
 *
 * Raised once, from 450 to 500 kB, with the defects of #311: the office had
 * grown to 451.7 kB with every screen in its first bundle, and nothing of it
 * was a careless import. Back at 450 kB since the screens of both entries are
 * loaded when somebody opens them (#831): what is measured is the first page
 * and its shell, at 372.6 kB for the office and 231.1 kB on site then.
 */
checkBudgets({
  dist: resolve(dirname(fileURLToPath(import.meta.url)), '..', 'dist'),
  budgets: [
    { name: 'Baustelle', document: 'm/index.html', limit: 300 * 1024 },
    { name: 'Büro', document: 'index.html', limit: 450 * 1024 },
  ],
})
