export const SPLASH_TYPE = {
  ADULT_VERIFICATION: 'AdultVerificationSplash',
} as const;

export type SplashType = (typeof SPLASH_TYPE)[keyof typeof SPLASH_TYPE];
