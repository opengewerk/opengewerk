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
 */
checkBudgets({
  dist: resolve(dirname(fileURLToPath(import.meta.url)), '..', 'dist'),
  budgets: [
    { name: 'Baustelle', document: 'm/index.html', limit: 300 * 1024 },
    { name: 'Büro', document: 'index.html', limit: 450 * 1024 },
  ],
})
