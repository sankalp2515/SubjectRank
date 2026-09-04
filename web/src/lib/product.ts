/**
 * The product's name lives here and nowhere else.
 *
 * Renaming is a one-line change by design (mission constraint): no component,
 * page title, meta tag or piece of copy hardcodes it.
 */
export const PRODUCT = {
  name: 'SubjectRank',
  tagline: 'Rank your subject lines by predicted performance',
  /** Shown in the footer. CC BY 4.0 attribution is mandatory, not optional. */
  dataCitation: {
    text:
      'Matias, J.N., Munger, K., Le Quere, M.A. et al. The Upworthy Research Archive, ' +
      'a time series of 32,487 experiments in U.S. media. Sci Data 8, 195 (2021).',
    href: 'https://doi.org/10.1038/s41597-021-00934-7',
    licence: 'CC BY 4.0',
  },
  limits: { minLines: 2, maxLines: 5, maxChars: 300 },
} as const;
