const scrollbar = require('tailwind-scrollbar');

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],

  darkMode: ['media'],

  theme: {
    extend: {
      // 색 토큰 — 원본은 사설 디자인시스템 프리셋이 주입했다. 공개 레포에서는
      // 소비처 클래스명(`bg-background-*` · `text-glyph-*`)을 그대로 유지한 채
      // 값만 여기서 정의한다. 이름이 같아야 컴포넌트 코드가 원본 그대로 읽힌다.
      colors: {
        background: {
          'base-normal': 'var(--v-background-base-normal)',
          'base-subtle': 'var(--v-background-base-subtle)',
          'base-elevate': 'var(--v-background-base-elevate)',
          'base-focus': 'var(--v-background-base-focus)',
          'base-blur': 'var(--v-background-base-blur)',
          'gray-elevate': 'var(--v-background-gray-elevate)',
          'accent-normal': 'var(--v-background-accent-normal)',
          'accent-elevate': 'var(--v-background-accent-elevate)',
          'accent-focus': 'var(--v-background-accent-focus)',
          'danger-normal': 'var(--v-background-danger-normal)',
          'success-normal': 'var(--v-background-success-normal)',
        },
        // 경계선. 배경과 글리프 사이의 세 번째 계열이라 따로 둔다 —
        // 배경색으로 선을 그리면 대비가 테마마다 무너진다.
        line: {
          'outline-stroke': 'var(--v-line-outline-stroke)',
        },
        // 오버레이·딤. 알파를 포함하므로 배경 계열과 섞지 않는다.
        effect: {
          'dim-modal': 'var(--v-effect-dim-modal)',
        },
        // 반전 표면(어두운 배경 위) 전용 글리프.
        'invert-glyph': {
          'gray-display': 'var(--v-invert-glyph-gray-display)',
        },
        glyph: {
          'gray-display': 'var(--v-glyph-gray-display)',
          'gray-heading': 'var(--v-glyph-gray-heading)',
          'gray-body': 'var(--v-glyph-gray-body)',
          'gray-description': 'var(--v-glyph-gray-description)',
          'gray-caption': 'var(--v-glyph-gray-caption)',
          'accent-heading': 'var(--v-glyph-accent-heading)',
          'accent-white-display': 'var(--v-glyph-white-display)',
          'accent-red-heading': 'var(--v-glyph-red-heading)',
        },
      },
      // 박스 섀도우
      boxShadow: {
        modal: '0 4px 24px 0 var(--color-effect-shadow-modal)',
      },
      // 키오스크 디바이스별 브레이크포인트
      screens: {
        lg: '1440px',
        md: '768px',
        sm: '426px',
        mini: '333px', // 800px / 2.4 ≈ 333px (Electron zoom 적용)
        stand: '450px', // 1080px / 2.4 = 450px
      },
      // 프로젝트 spacing 시스템 (space-N = N * 2px)
      spacing: {
        'space-1': '2px',
        'space-2': '4px',
        'space-3': '6px',
        'space-4': '8px',
        'space-5': '10px',
        'space-6': '12px',
        'space-7': '14px',
        'space-8': '16px',
        'space-9': '18px',
        'space-10': '20px',
        'space-11': '22px',
        'space-12': '24px',
        'space-13': '26px',
        'space-14': '28px',
        'space-15': '30px',
        'space-16': '32px',
        'space-17': '34px',
        'space-18': '36px',
        'space-19': '38px',
        'space-20': '40px',
        'space-21': '42px',
        'space-22': '44px',
        'space-23': '46px',
        'space-24': '48px',
        'space-25': '50px',
        'space-26': '52px',
        'space-27': '54px',
        'space-28': '56px',
        'space-29': '58px',
        'space-30': '60px',
        'space-31': '62px',
        'space-32': '64px',
        'space-33': '66px',
        'space-34': '68px',
        'space-35': '70px',
        'space-36': '72px',
        'space-37': '74px',
        'space-38': '76px',
        'space-39': '78px',
        'space-40': '80px',

        'safe-bottom-kiosk': 'var(--safe-bottom-kiosk, 52px)',
        'safe-top-kiosk': 'var(--safe-top-kiosk, 32px)',
      },
    },
  },

  plugins: [
    scrollbar,
  ],
};
