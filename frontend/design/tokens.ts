import { Platform } from 'react-native';

export const colors = {
  canvas: '#F8F7F2',
  surfacePrimary: '#FFFDF8',
  surfaceSecondary: '#EFEBE2',
  inkPrimary: '#151412',
  inkSecondary: '#6D6861',
  inkMuted: '#918A81',
  border: '#C8C1B6',
  accent: '#315B2C',
  accentPressed: '#234421',
  accentSoft: '#E6EDE2',
  success: '#37614C',
  error: '#A33A32',
  imageFallback: '#11100F',
  inactiveNav: '#7D766D',
  inputBorder: '#CFC3B2',
  deepBlack: '#11100F',
};

export const spacing = {
  xxs: 4,
  xs: 8,
  sm: 12,
  md: 16,
  lg: 20,
  xl: 24,
  xxl: 32,
  xxxl: 40,
};

export const radius = {
  card: 12,
  smallCard: 10,
  segmented: 0,
  control: 10,
  thumbnail: 10,
};

export const fonts = {
  masthead: Platform.select({
    ios: 'Bodoni 72',
    android: 'serif',
    default: 'Georgia',
  }),
  display: Platform.select({
    ios: 'Georgia',
    android: 'serif',
    default: 'Georgia',
  }),
  headline: Platform.select({
    ios: 'Georgia',
    android: 'serif',
    default: 'Georgia',
  }),
  inter: Platform.select({
    ios: undefined,
    android: 'sans-serif',
    default: 'Arial',
  }),
};

export const typeScale = {
  masthead: {
    fontFamily: fonts.masthead,
    fontSize: 34,
    lineHeight: 38,
    fontWeight: '600' as const,
    letterSpacing: -0.7,
    textTransform: 'uppercase' as const,
  },
  editionTitle: {
    fontFamily: fonts.display,
    fontSize: 43,
    lineHeight: 46,
    fontWeight: '500' as const,
  },
  screenTitle: {
    fontFamily: fonts.display,
    fontSize: 38,
    lineHeight: 41,
    fontWeight: '500' as const,
  },
  articleHeadline: {
    fontFamily: fonts.headline,
    fontSize: 18,
    lineHeight: 22,
    fontWeight: '600' as const,
  },
  savedHeadline: {
    fontFamily: fonts.headline,
    fontSize: 19,
    lineHeight: 23,
    fontWeight: '600' as const,
  },
  summary: {
    fontFamily: fonts.inter,
    fontSize: 16,
    lineHeight: 23,
    fontWeight: '400' as const,
  },
  whyItMatters: {
    fontFamily: fonts.inter,
    fontSize: 15,
    lineHeight: 21,
    fontWeight: '400' as const,
  },
  sectionLabel: {
    fontFamily: fonts.inter,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '600' as const,
    letterSpacing: 1.4,
    textTransform: 'uppercase' as const,
  },
  source: {
    fontFamily: fonts.inter,
    fontSize: 13,
    lineHeight: 17,
    fontWeight: '600' as const,
  },
  metadata: {
    fontFamily: fonts.inter,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '400' as const,
  },
  button: {
    fontFamily: fonts.inter,
    fontSize: 15,
    lineHeight: 18,
    fontWeight: '600' as const,
  },
  bottomNavigation: {
    fontFamily: fonts.inter,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '500' as const,
  },
  input: {
    fontFamily: fonts.inter,
    fontSize: 16,
    lineHeight: 21,
    fontWeight: '400' as const,
  },
};

export const shadows = {
  card: {
    shadowColor: '#201B16',
    shadowOpacity: 0.16,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 14 },
    elevation: 7,
  },
};

export const layout = {
  margin: spacing.lg,
  cardPadding: spacing.lg,
  tabBarHeight: 64,
  iconButton: 44,
  minTouch: 44,
};

export const motion = {
  cardMs: 240,
  quickMs: 180,
};
