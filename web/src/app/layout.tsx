import type { Metadata } from 'next';
import { PRODUCT } from '@/lib/product';

/*
 * globals.css now carries the whole design system — the `@theme` block, the
 * oklch tokens and the glass utilities all live there, ported from the
 * handed-over design.
 *
 * The old `design/tokens.css` layer is gone. It described a different visual
 * language (a slate/indigo palette on flat surfaces) and nothing renders against
 * it any more; keeping it would leave two token systems in the tree with only
 * the import order deciding which one wins. That is exactly how the previous
 * silent failure happened, when an unresolved `@import` left every var()
 * undefined and 44px controls rendered 21px tall.
 */
import './globals.css';

export const metadata: Metadata = {
  title: `${PRODUCT.name} — compare email subject lines, honestly`,
  description:
    'Paste 2–5 email subject lines and see them ranked against each other, pair by ' +
    'pair, with reasoning you can check. No score out of 100, no predicted open rate.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/*
          Nunito for the interface and Fraunces for the moments the design sets
          in serif — the visitor's own subject lines in the reason rail, and the
          emphasis inside the limitation notice.

          These are the two faces the design was drawn with. The previous
          direction deliberately used the visitor's system face for their own
          text; that reasoning belonged to that design, and this one makes a
          different call, which is the interface author's call to make.
        */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800;900&family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600&display=swap"
        />
        {/*
          The palette is a single deliberate light world — a pastel field with
          frosted panels. There is no dark variant of it, so the browser is told
          that rather than left to invert form controls against a ground that
          never changes.
        */}
        <meta name="color-scheme" content="light" />
      </head>
      <body>{children}</body>
    </html>
  );
}
