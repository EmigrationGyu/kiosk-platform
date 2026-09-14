/**
 * 디자인 시스템 프리미티브 (포트폴리오용 로컬 구현).
 *
 * 원본은 사내 사설 패키지였다. 공개 레포에서 `install` 이 깨지지 않도록 **표면만 동일하게**
 * 다시 구현한 것이라, 소비처(A11yNode·키보드·모달)의 코드 모양은 원본 그대로다.
 *
 * `data-pressable` 은 장식이 아니다 — `shared/a11y/registry.ts` 가 이 속성으로 "이미
 * focusable 한 요소"를 판별해 이중 탭스톱을 피한다. 지우면 접근성 네비게이션이 깨진다.
 */
import {
  type ButtonHTMLAttributes,
  createContext,
  forwardRef,
  type InputHTMLAttributes,
  type ReactNode,
  useContext,
} from 'react';
import type { IconGlyph } from './icons';

export const ColorScheme = { Light: 'light', Dark: 'dark' } as const;
export type ColorScheme = (typeof ColorScheme)[keyof typeof ColorScheme];

export const CVS = { Normal: 'normal', High: 'high' } as const;
export type CVS = (typeof CVS)[keyof typeof CVS];

export const ThemeColor = {
  Normal: 'normal',
  Blue: 'blue',
  Brown: 'brown',
  Cyan: 'cyan',
  Green: 'green',
  Indigo: 'indigo',
  Magenta: 'magenta',
  Orange: 'orange',
  Orangered: 'orangered',
  Pink: 'pink',
  Purple: 'purple',
  Red: 'red',
  Teal: 'teal',
  Violet: 'violet',
  Yellow: 'yellow',
} as const;
export type ThemeColor = (typeof ThemeColor)[keyof typeof ThemeColor];

type ThemeState = {
  themeColor: ThemeColor;
  cvsMode: CVS;
  preferScheme: ColorScheme;
};
const ThemeContext = createContext<ThemeState>({
  themeColor: ThemeColor.Normal,
  cvsMode: CVS.Normal,
  preferScheme: ColorScheme.Light,
});
export const useTheme = () => useContext(ThemeContext);

export const VDSProvider = ({
  children,
  themeColor = ThemeColor.Normal,
  cvsMode = CVS.Normal,
  preferScheme = ColorScheme.Light,
}: Partial<ThemeState> & { children: ReactNode }) => (
  <ThemeContext.Provider value={{ themeColor, cvsMode, preferScheme }}>
    <div
      className="contents"
      data-theme-color={themeColor}
      data-cvs={cvsMode}
      data-scheme={preferScheme}
    >
      {children}
    </div>
  </ThemeContext.Provider>
);

type PressableProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'onClick' | 'type'
> & { onPress?: () => void; children?: ReactNode };

export const Pressable = forwardRef<HTMLButtonElement, PressableProps>(
  ({ onPress, className = '', children, ...rest }, ref) => (
    <button
      ref={ref}
      type="button"
      data-pressable="true"
      // 기본 chrome(배경·테두리·여백)은 tokens.css 가 [data-pressable] 로 준다.
      // 유틸리티로 두면 Button 이 얹는 색 클래스와 특이도가 같아, 승자를 Tailwind 의
      // 출력 순서가 정해버린다(bg-transparent 가 뒤에 나와 색을 덮었다).
      className={`disabled:opacity-40 ${className}`}
      onClick={onPress}
      {...rest}
    >
      {children}
    </button>
  ),
);
Pressable.displayName = 'Pressable';

export type ButtonKind = 'common' | 'accent' | 'danger' | 'naked';
export type ButtonHierarchy = 'primary' | 'secondary' | 'tertiary' | 'naked';
type ButtonSize = 'small' | 'medium' | 'large';

const BUTTON_KIND: Record<ButtonKind, Record<ButtonHierarchy, string>> = {
  naked: {
    primary: 'bg-transparent',
    secondary: 'bg-transparent',
    tertiary: 'bg-transparent',
    naked: 'bg-transparent',
  },
  common: {
    primary: 'bg-background-gray-elevate text-glyph-gray-heading',
    secondary: 'bg-background-base-elevate text-glyph-gray-body',
    tertiary: 'bg-transparent text-glyph-gray-description',
    naked: 'bg-transparent',
  },
  accent: {
    primary: 'bg-background-accent-normal text-glyph-accent-white-display',
    secondary: 'bg-background-accent-elevate text-glyph-accent-heading',
    tertiary: 'bg-transparent text-glyph-accent-heading',
    naked: 'bg-transparent',
  },
  danger: {
    primary: 'bg-background-danger-normal text-glyph-accent-white-display',
    secondary: 'bg-background-base-elevate text-glyph-accent-red-heading',
    tertiary: 'bg-transparent text-glyph-accent-red-heading',
    naked: 'bg-transparent',
  },
};

const BUTTON_SIZE: Record<ButtonSize, string> = {
  small: 'h-[36px] px-[12px] rounded-[8px] typo-b3-m',
  medium: 'h-[48px] px-[16px] rounded-[10px] typo-b2-sb',
  large: 'h-[60px] px-[20px] rounded-[12px] typo-b1-sb',
};

export type ButtonProps = PressableProps & {
  kind?: ButtonKind;
  hierarchy?: ButtonHierarchy;
  size?: ButtonSize;
  loading?: boolean;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      kind = 'common',
      hierarchy = 'primary',
      size = 'medium',
      loading = false,
      className = '',
      children,
      ...rest
    },
    ref,
  ) => (
    <Pressable
      ref={ref}
      className={`inline-flex items-center justify-center ${BUTTON_KIND[kind][hierarchy]} ${BUTTON_SIZE[size]} ${className}`}
      {...rest}
    >
      {loading ? <span className="animate-pulse">…</span> : children}
    </Pressable>
  ),
);
Button.displayName = 'Button';

export const Icon = ({
  icon: Glyph,
  size = 24,
  className = '',
}: {
  icon: IconGlyph;
  size?: number;
  className?: string;
}) => <Glyph width={size} height={size} className={className} />;

type IconButtonProps = PressableProps & {
  icon: IconGlyph;
  size?: number;
  /** 시각 계열. shim 은 배경만 가른다. */
  kind?: ButtonKind;
  hierarchy?: ButtonHierarchy;
  /** 'circle' 이면 완전한 원. */
  shape?: 'circle' | 'square';
};

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  (
    {
      icon,
      size = 24,
      kind = 'common',
      hierarchy = 'tertiary',
      shape = 'square',
      className = '',
      ...rest
    },
    ref,
  ) => (
    <Pressable
      ref={ref}
      className={`inline-flex items-center justify-center p-space-2 ${BUTTON_KIND[kind][hierarchy]} ${shape === 'circle' ? 'rounded-full' : 'rounded-[8px]'} ${className}`}
      {...rest}
    >
      <Icon icon={icon} size={size} />
    </Pressable>
  ),
);
IconButton.displayName = 'IconButton';

export type TextInputProps = InputHTMLAttributes<HTMLInputElement> & {
  /** 입력 우측 슬롯(지우기 버튼 등). */
  right?: ReactNode;
  kind?: ButtonKind;
};

export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(
  ({ className = '', right, kind: _kind, ...rest }, ref) => (
    <div className="relative w-full">
      <input
        ref={ref}
        className={`w-full bg-background-base-elevate text-glyph-gray-body rounded-[10px] px-[12px] h-[48px] outline-none ${right ? 'pr-[44px]' : ''} ${className}`}
        {...rest}
      />
      {right ? (
        <span className="absolute right-[8px] top-1/2 -translate-y-1/2">
          {right}
        </span>
      ) : null}
    </div>
  ),
);
TextInput.displayName = 'TextInput';

export const Input = TextInput;

export const LinearGradient = ({
  from = 'transparent',
  to = 'transparent',
  direction = 'to bottom',
  className = '',
  style,
}: {
  from?: string;
  to?: string;
  direction?: string;
  className?: string;
  style?: React.CSSProperties;
}) => (
  <div
    className={className}
    style={{
      backgroundImage: `linear-gradient(${direction}, ${from}, ${to})`,
      ...style,
    }}
  />
);

export type { IconGlyph } from './icons';
