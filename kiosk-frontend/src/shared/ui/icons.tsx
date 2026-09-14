import type { SVGProps } from 'react';

export type IconGlyph = (props: SVGProps<SVGSVGElement>) => React.ReactElement;

const glyph =
  (path: string): IconGlyph =>
  (props) => (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d={path} />
    </svg>
  );

export const ic_xmark = glyph('M6 6l12 12M18 6L6 18');
export const ic_globe = glyph(
  'M12 3a9 9 0 100 18 9 9 0 000-18zM3 12h18M12 3c2.5 2.4 3.8 5.4 3.8 9S14.5 18.6 12 21c-2.5-2.4-3.8-5.4-3.8-9S9.5 5.4 12 3z',
);
