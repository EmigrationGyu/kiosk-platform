import { playKeyClick } from '@/shared/lib/keyClick/keyClick';
import { Pressable } from '@/shared/ui';

// a11y(TBD — 방향 논의 후 결정, 미구현): 온스크린 키보드 키는 정적 a11yKey/카탈로그 모델 밖이다
// (키 무한·다국어·대소문자, Figma 는 global_keyboard 컨테이너 1키만). 계획 방향 = 키별 a11yKey 대신
// focus/press 시 라벨을 브라우저 SpeechSynthesis(Web Speech API)로 발화 — 녹음 클립 TTS 가 단문자를
// 잘 못 읽는 문제를 회피. 글자키는 라벨 그대로, 기호·기능·자모키(!@#$, space, ⌫, shift, ㄱ…)는
// 언어별 발화이름 매핑 테이블 경유("!"→느낌표/exclamation 등). 미결: ① 키오스크 OS 보이스 설치 의존
// ② AudioPlayer 와 인터럽트/덕킹 코디 ③ 성우음↔합성음 이중성 수용 여부. 확정 전까지 키 미부여.

// Tolgee dev mode에서 삽입되는 제어 문자(ZWJ, ZWNJ 등) 제거
function cleanKey(key: string) {
  if (!key) return key;
  return key.replace(/[\u200B-\u200D\uFEFF]/g, '');
}

const KeyboardKey = ({
  label,
  onKeyPress,
  width = '39px',
  height = '48px',
}: {
  label: string;
  onKeyPress: (key: string) => void;
  width?: string;
  height?: string;
}) => {
  return (
    <Pressable
      onPress={() => {
        playKeyClick();
        onKeyPress(cleanKey(label));
      }}
    >
      <div
        style={{ width, height }}
        className="flex items-center justify-center bg-background-base-blur rounded-[6px] shadow-[0_1px_0_0.25px_var(--v-background-base-focus)]"
      >
        <span className="text-glyph-gray-body typo-t1-m text-center">
          {label}
        </span>
      </div>
    </Pressable>
  );
};

export default KeyboardKey;
