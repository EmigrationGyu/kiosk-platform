import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import dayjs from 'dayjs';
import {
  DATE_FORMAT_WITH_WEEKDAY_BY_LANGUAGE,
  DATE_TIME_FORMAT_BY_LANGUAGE,
  DATE_WITH_TIME_FORMAT_BY_LANGUAGE,
  TIME_FORMAT_BY_LANGUAGE,
} from '@/shared/constants/tolgeeKey';
import { setDayjsLocaleFromTolgeeLanguage } from './dayjs';

/**
 * 이 테스트의 목적:
 * Tolgee CDN에서 내려온 "포맷 문자열"이 dayjs.format()에 들어가면
 * 의도된 형식으로 출력되는지(통합 테스트) 검증합니다.
 *
 * 전제:
 * - Tolgee에 아래 4개 키가 언어별로 올바른 값으로 등록되어 있어야 합니다.
 *   TIME_FORMAT_BY_LANGUAGE
 *   DATE_TIME_FORMAT_BY_LANGUAGE
 *   DATE_FORMAT_WITH_WEEKDAY_BY_LANGUAGE
 *   DATE_WITH_TIME_FORMAT_BY_LANGUAGE
 */

describe('Tolgee dayjs format keys (integration: fetch from CDN)', () => {
  const readEnvVarFromDotenv = (key: string): string | undefined => {
    // 로컬 개발 환경에서 `.env`에만 값이 있고 shell env에 없을 수 있어서 fallback으로 읽습니다.
    try {
      const raw = readFileSync('.env', 'utf8');
      const lines = raw.split(/\r?\n/);
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const idx = trimmed.indexOf('=');
        if (idx <= 0) continue;
        const k = trimmed.slice(0, idx).trim();
        if (k !== key) continue;
        let v = trimmed.slice(idx + 1).trim();
        // strip quotes
        if (
          (v.startsWith('"') && v.endsWith('"')) ||
          (v.startsWith("'") && v.endsWith("'"))
        ) {
          v = v.slice(1, -1);
        }
        return v || undefined;
      }
      return undefined;
    } catch {
      return undefined;
    }
  };

  const RUN =
    process.env.RUN_TOLGEE_INTEGRATION_TESTS === '1' ||
    process.env.RUN_TOLGEE_INTEGRATION_TESTS === 'true';
  const CDN_PREFIX =
    process.env.VITE_TOLGEE_CDN_PREFIX ??
    process.env.TOLGEE_CDN_PREFIX ??
    readEnvVarFromDotenv('VITE_TOLGEE_CDN_PREFIX') ??
    readEnvVarFromDotenv('TOLGEE_CDN_PREFIX');

  const testOrSkip = RUN && CDN_PREFIX ? it : it.skip;

  const getFlatString = (
    json: Record<string, unknown>,
    key: string,
  ): string => {
    const value = json[key];
    if (typeof value === 'string') return value;
    const topKeys = Object.keys(json).slice(0, 50);
    throw new Error(
      `Tolgee CDN JSON에서 "${key}"가 문자열로 존재하지 않습니다. (현재 타입: ${typeof value}) (top-level keys sample: ${topKeys.join(
        ', ',
      )})`,
    );
  };

  testOrSkip(
    'should fetch {prefix}{language}.json from Tolgee CDN and produce intended outputs',
    async () => {
      const baseDate = new Date(2026, 0, 9, 15, 7, 0); // 2026-01-09 15:07:00 (local)

      const cases = [
        {
          language: 'ko-KR',
          expected: {
            time: '오후 3:07',
            dateTime: '1. 9. 오후 3:07',
            dateWithWeekday: '1. 9. 금',
            dateWithTime: '2026년 1월 9일 오후 3시',
          },
        },
        {
          language: 'en-US',
          expected: {
            time: '3:07 PM',
            dateTime: '1/9 3:07 PM',
            dateWithWeekday: '1/9 Fri',
            dateWithTime: 'January 9, 2026 3 PM',
          },
        },
        {
          language: 'ja-JP',
          expected: {
            time: '午後 3:07',
            dateTime: '1/9 午後 3:07',
            dateWithWeekday: '1/9 金',
            dateWithTime: '2026年1月9日 午後 3時',
          },
        },
        {
          language: 'zh',
          expected: {
            time: '下午 3:07',
            dateTime: '1/9 下午 3:07',
            dateWithWeekday: '1/9 周五',
            dateWithTime: '2026年1月9日 下午 3时',
          },
        },
        {
          language: 'zh-Hant-TW',
          expected: {
            time: '下午 3:07',
            dateTime: '1/9 下午 3:07',
            dateWithWeekday: '1/9 週五',
            dateWithTime: '2026年1月9日 下午 3時',
          },
        },
      ] as const;

      for (const c of cases) {
        const res = await fetch(`${CDN_PREFIX}${c.language}.json`, {
          headers: { accept: 'application/json' },
        });
        expect(res.ok).toBe(true);
        const json = (await res.json()) as Record<string, unknown>;

        const timeFormat = getFlatString(json, TIME_FORMAT_BY_LANGUAGE);
        const dateTimeFormat = getFlatString(
          json,
          DATE_TIME_FORMAT_BY_LANGUAGE,
        );
        const dateWithWeekdayFormat = getFlatString(
          json,
          DATE_FORMAT_WITH_WEEKDAY_BY_LANGUAGE,
        );
        const dateWithTimeFormat = getFlatString(
          json,
          DATE_WITH_TIME_FORMAT_BY_LANGUAGE,
        );

        // locale까지 포함해서 "의도된 표기"가 나오는지 검증
        setDayjsLocaleFromTolgeeLanguage(c.language);
        const value = dayjs(baseDate);

        expect(value.format(timeFormat)).toBe(c.expected.time);
        expect(value.format(dateTimeFormat)).toBe(c.expected.dateTime);
        expect(value.format(dateWithWeekdayFormat)).toBe(
          c.expected.dateWithWeekday,
        );
        expect(value.format(dateWithTimeFormat)).toBe(c.expected.dateWithTime);
      }
    },
    20000,
  );
});
