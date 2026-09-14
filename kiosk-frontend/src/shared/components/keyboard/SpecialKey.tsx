import type { ReactNode } from 'react';
import type { KeyClickVariant } from '@/shared/lib/keyClick/keyClick';
import {
  KEY_CLICK_VARIANTS,
  playKeyClick,
} from '@/shared/lib/keyClick/keyClick';
import { Pressable } from '@/shared/ui';

const SpecialKey = ({
  content,
  onKeyPress,
  width = '61px',
  height = '48px',
  clickVariant = KEY_CLICK_VARIANTS.MODIFIER,
}: {
  content: string | ReactNode;
  onKeyPress: () => void;
  width?: string;
  height?: string;
  /** 지움/확정은 호출부가 바꿔 준다. */
  clickVariant?: KeyClickVariant;
}) => {
  return (
    <Pressable
      onPress={() => {
        playKeyClick(clickVariant);
        onKeyPress();
      }}
    >
      <div
        style={{ width, height }}
        className="flex items-center justify-center bg-background-base-focus rounded-[6px] shadow-[0_1px_0_0.25px_var(--v-background-base-focus)]"
      >
        <span className="text-glyph-gray-body typo-b2-sb text-center">
          {content}
        </span>
      </div>
    </Pressable>
  );
};

export default SpecialKey;
