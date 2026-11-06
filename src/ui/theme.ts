/**
 * Design tokens. Products replace these with their design system's; screens use only tokens,
 * never literal colors or sizes, so a product restyles the app in this one file.
 */
import { useColorScheme } from "react-native";

const light = {
  background: "#F5F7F8",
  surface: "#FFFFFF",
  text: "#1C262B",
  muted: "#5B6A72",
  border: "#D5DDE1",
  accent: "#0B6475",
  onAccent: "#FFFFFF",
  warning: "#8A5300",
  warningSurface: "#FFF3DF",
  danger: "#A3261D",
  dangerSurface: "#FCE9E7",
};

const dark: typeof light = {
  background: "#11181B",
  surface: "#1A2328",
  text: "#E8EEF0",
  muted: "#9AABB3",
  border: "#2E3B41",
  accent: "#5BC0D3",
  onAccent: "#0B1C21",
  warning: "#F2B95C",
  warningSurface: "#3A2C12",
  danger: "#F28B82",
  dangerSurface: "#3B1D1A",
};

export type Colors = typeof light;

export const space = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 } as const;
export const radius = { sm: 6, md: 10 } as const;
export const type = {
  title: { fontSize: 28, lineHeight: 34, fontWeight: "700" },
  heading: { fontSize: 18, lineHeight: 24, fontWeight: "600" },
  body: { fontSize: 16, lineHeight: 22, fontWeight: "400" },
  small: { fontSize: 14, lineHeight: 20, fontWeight: "400" },
} as const;
/** Touch targets: at least 44 points (Apple) and 48 dp (Android). */
export const touch = 48;

export function useColors(): Colors {
  return useColorScheme() === "dark" ? dark : light;
}
