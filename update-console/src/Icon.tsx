/** 화면에 쓰는 아이콘 — 글리프 대신 그린다(폰트에 따라 모양이 갈리지 않게). */

const stroke = {
  fill: 'none',
  stroke: 'currentColor',
  'aria-hidden': true,
} as const;

export const Caret = ({ open }: { open: boolean }) => (
  <svg
    width="10"
    height="10"
    viewBox="0 0 24 24"
    strokeWidth="3"
    style={open ? undefined : { transform: 'rotate(-90deg)' }}
    {...stroke}
  >
    <title>{open ? '펼침' : '접힘'}</title>
    <path d="M6 9l6 6 6-6" />
  </svg>
);

export const ZoomIcon = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" strokeWidth="2.5" {...stroke}>
    <title>확대</title>
    <path d="M14 4h6v6" />
    <path d="M10 20H4v-6" />
    <path d="M20 4l-7 7" />
    <path d="M4 20l7-7" />
  </svg>
);

export const CloseIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" strokeWidth="2.5" {...stroke}>
    <title>닫기</title>
    <path d="M6 6l12 12" />
    <path d="M18 6L6 18" />
  </svg>
);
