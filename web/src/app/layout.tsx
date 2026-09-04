import type { Metadata } from 'next';
import { PRODUCT } from '@/lib/product';
// Token layer first: globals.css and every CSS Module read these variables, so
// they have to be defined before anything consumes them.
//
// Imported here rather than via `@import` inside globals.css — Turbopack did not
// resolve that import, and the failure was silent and total: every var() fell
// back to nothing, so `min-height: var(--btn-height)` evaluated to no rule at
// all and every 44px control rendered 21px tall. Nothing errored; the page just
// quietly lost its design system.
import '@/design/tokens.css';
import './globals.css';

export const metadata: Metadata = {
  title: `${PRODUCT.name} — put your subject lines in order`,
  description:
    'Paste two to five email subject lines and see which one a model trained on ' +
    '27,616 randomised headline experiments puts first — with the reasoning marked ' +
    'on the words you wrote, and an honest answer when it cannot tell two apart.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/*
          One webfont, and it is the MACHINE's voice — labels, placings,
          measurements. Subject lines and prose deliberately use the visitor's own
          system UI face: that is close to what their mail client will render the
          line in, and setting someone's draft in a bought typeface flatters it
          into looking like something it is not.
        */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&display=swap"
        />
        <meta name="color-scheme" content="light" />
      </head>
      <body>{children}</body>
    </html>
  );
}
