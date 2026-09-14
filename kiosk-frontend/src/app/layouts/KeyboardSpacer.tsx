import { motion } from 'motion/react';
import { useKeyboardAwareness } from '@/shared/hooks/useKeyboardAwareness';
import { SAFE_BOTTOM_KIOSK } from '@/shared/lib/keyboard/constants';

const KeyboardSpacer = () => {
  const { keyboardHeight } = useKeyboardAwareness();
  return (
    <motion.div
      className="shrink-0 bg-transparent"
      style={{ height: SAFE_BOTTOM_KIOSK + keyboardHeight }}
    />
  );
};

export default KeyboardSpacer;
