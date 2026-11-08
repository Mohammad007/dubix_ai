import { useWindowDimensions } from 'react-native';

import { breakpoints } from '@/theme/tokens';

/** Responsive helpers: phones use one column and a bottom tab bar; tablets get a side rail and grids. */
export function useLayout() {
  const { width, height } = useWindowDimensions();
  const isTablet = Math.min(width, height) >= 600 || width >= breakpoints.tablet;
  const isWide = width >= breakpoints.wide;
  const landscape = width > height;
  return { width, height, isTablet, isWide, landscape, columns: isWide ? 3 : isTablet ? 2 : 1 };
}
