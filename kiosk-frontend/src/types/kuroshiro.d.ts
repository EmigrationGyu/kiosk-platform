declare module 'kuroshiro' {
  export interface KuroshiroOptions {
    to?: 'hiragana' | 'katakana' | 'romaji';
    mode?: 'normal' | 'spaced' | 'okurigana' | 'furigana';
    romajiSystem?:
      | 'nippon'
      | 'passport'
      | 'hepburn'
      | 'kunrei'
      | 'nihon'
      | 'wapuro';
  }

  export default class Kuroshiro {
    constructor();
    init(analyzer): Promise<void>;
    convert(str: string, options?: KuroshiroOptions): Promise<string>;
  }
}

declare module 'kuroshiro-analyzer-kuromoji' {
  export interface KuromojiAnalyzerOptions {
    dictPath?: string;
  }

  export default class KuromojiAnalyzer {
    constructor(options?: KuromojiAnalyzerOptions);
  }
}
