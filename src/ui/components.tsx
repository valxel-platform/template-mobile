import type { ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { radius, space, touch, type, useColors } from "./theme";

export function Screen({ children }: { children: ReactNode }) {
  const c = useColors();
  return (
    <SafeAreaView style={[styles.fill, { backgroundColor: c.background }]}>
      <ScrollView contentContainerStyle={styles.screen} keyboardShouldPersistTaps="handled">
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

export function Title({ children }: { children: ReactNode }) {
  const c = useColors();
  return (
    <Text accessibilityRole="header" style={[type.title, { color: c.text }]}>
      {children}
    </Text>
  );
}

export function Heading({ children }: { children: ReactNode }) {
  const c = useColors();
  return (
    <Text accessibilityRole="header" style={[type.heading, { color: c.text }]}>
      {children}
    </Text>
  );
}

export function Body({ children, muted }: { children: ReactNode; muted?: boolean }) {
  const c = useColors();
  return <Text style={[type.body, { color: muted ? c.muted : c.text }]}>{children}</Text>;
}

export function Button({
  label,
  onPress,
  kind = "primary",
  busy,
  disabled,
}: {
  label: string;
  onPress: () => void;
  kind?: "primary" | "secondary";
  busy?: boolean;
  disabled?: boolean;
}) {
  const c = useColors();
  const primary = kind === "primary";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: disabled || busy, busy }}
      disabled={disabled || busy}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: primary ? c.accent : "transparent",
          borderColor: c.accent,
          opacity: disabled ? 0.5 : pressed ? 0.8 : 1,
        },
      ]}
    >
      {busy ? (
        <ActivityIndicator color={primary ? c.onAccent : c.accent} />
      ) : (
        <Text style={[type.body, styles.buttonText, { color: primary ? c.onAccent : c.accent }]}>
          {label}
        </Text>
      )}
    </Pressable>
  );
}

export function Field({ label, ...input }: TextInputProps & { label: string }) {
  const c = useColors();
  return (
    <View style={styles.field}>
      <Text style={[type.small, { color: c.muted }]}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={c.muted}
        style={[
          type.body,
          styles.input,
          { color: c.text, borderColor: c.border, backgroundColor: c.surface },
        ]}
        {...input}
      />
    </View>
  );
}

export function Notice({ tone, children }: { tone: "warning" | "danger"; children: ReactNode }) {
  const c = useColors();
  return (
    <View
      accessible
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      style={[styles.notice, { backgroundColor: tone === "warning" ? c.warningSurface : c.dangerSurface }]}
    >
      <Text style={[type.small, { color: tone === "warning" ? c.warning : c.danger }]}>{children}</Text>
    </View>
  );
}

export function Card({ children }: { children: ReactNode }) {
  const c = useColors();
  return <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}>{children}</View>;
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  screen: { padding: space.md, gap: space.md, maxWidth: 640, width: "100%", alignSelf: "center" },
  button: {
    minHeight: touch,
    borderRadius: radius.md,
    borderWidth: 1,
    paddingHorizontal: space.md,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonText: { fontWeight: "600" },
  field: { gap: space.xs },
  input: {
    minHeight: touch,
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: space.sm + space.xs,
  },
  notice: { padding: space.sm + space.xs, borderRadius: radius.sm },
  card: { borderWidth: 1, borderRadius: radius.md, padding: space.md, gap: space.sm },
});
