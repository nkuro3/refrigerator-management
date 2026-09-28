import type { ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  type PressableProps,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  type TextInputProps,
  View,
  type ViewStyle,
} from "react-native";

export const colors = {
  bg: "#F6F7F5",
  card: "#FFFFFF",
  text: "#1F2421",
  sub: "#6B736E",
  border: "#E1E5E2",
  primary: "#2F7D5B",
  primaryText: "#FFFFFF",
  soft: "#E8F2EC",
  warn: "#B7791F",
  warnSoft: "#FDF3E1",
  danger: "#C0392B",
  dangerSoft: "#FBEAE8",
  info: "#2B6CB0",
  infoSoft: "#E6F0FA",
};

export function Screen({ children, scroll = true }: { children: ReactNode; scroll?: boolean }) {
  if (!scroll) return <View style={styles.screen}>{children}</View>;
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.screenContent} keyboardShouldPersistTaps="handled">
      {children}
    </ScrollView>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <Text style={styles.sectionTitle}>{children}</Text>;
}

type ButtonProps = Omit<PressableProps, "children"> & {
  title: string;
  variant?: "primary" | "secondary" | "danger" | "ghost";
  loading?: boolean;
  small?: boolean;
};

export function Button({ title, variant = "primary", loading, small, disabled, style, ...rest }: ButtonProps) {
  const v = buttonVariants[variant];
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled || loading}
      style={(state) => [
        styles.button,
        small && styles.buttonSmall,
        { backgroundColor: v.bg, borderColor: v.border, opacity: disabled ? 0.5 : state.pressed ? 0.8 : 1 },
        typeof style === "function" ? style(state) : style,
      ]}
      {...rest}
    >
      {loading ? <ActivityIndicator color={v.fg} /> : <Text style={[styles.buttonText, { color: v.fg }, small && { fontSize: 14 }]}>{title}</Text>}
    </Pressable>
  );
}

const buttonVariants = {
  primary: { bg: colors.primary, fg: colors.primaryText, border: colors.primary },
  secondary: { bg: colors.card, fg: colors.primary, border: colors.primary },
  danger: { bg: colors.card, fg: colors.danger, border: colors.danger },
  ghost: { bg: "transparent", fg: colors.sub, border: "transparent" },
};

export function Chip({ label, selected, onPress, tone }: {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  tone?: "warn" | "danger" | "info";
}) {
  const toneStyle = tone === "warn"
    ? { backgroundColor: colors.warnSoft, borderColor: colors.warnSoft }
    : tone === "danger"
      ? { backgroundColor: colors.dangerSoft, borderColor: colors.dangerSoft }
      : tone === "info"
        ? { backgroundColor: colors.infoSoft, borderColor: colors.infoSoft }
        : null;
  const textColor = tone === "warn" ? colors.warn : tone === "danger" ? colors.danger : tone === "info" ? colors.info : selected ? colors.primaryText : colors.text;
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? "button" : undefined}
      accessibilityState={{ selected }}
      style={[styles.chip, selected && styles.chipSelected, toneStyle]}
    >
      <Text style={[styles.chipText, { color: textColor }]}>{label}</Text>
    </Pressable>
  );
}

export function Field({ label, ...props }: TextInputProps & { label: string }) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={styles.label}>{label}</Text>
      <TextInput placeholderTextColor={colors.sub} style={styles.input} {...props} />
    </View>
  );
}

export function Loading() {
  return (
    <View style={styles.center}>
      <ActivityIndicator color={colors.primary} />
    </View>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <View style={[styles.center, { padding: 32, gap: 12 }]}>
      <Text style={styles.emptyTitle}>{title}</Text>
      {children}
    </View>
  );
}

export function ErrorText({ error }: { error: unknown }) {
  if (!error) return null;
  return <Text style={{ color: colors.danger }}>{error instanceof Error ? error.message : String(error)}</Text>;
}

export const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  screenContent: { padding: 16, gap: 16, paddingBottom: 48 },
  card: {
    backgroundColor: colors.card,
    borderRadius: 12,
    padding: 16,
    gap: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  sectionTitle: { fontSize: 15, fontWeight: "700", color: colors.text },
  button: {
    minHeight: 48,
    paddingHorizontal: 16,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonSmall: { minHeight: 36, paddingHorizontal: 12 },
  buttonText: { fontSize: 16, fontWeight: "600" },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  chipSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: 13, fontWeight: "600" },
  label: { fontSize: 13, color: colors.sub, fontWeight: "600" },
  input: {
    minHeight: 44,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    fontSize: 16,
    color: colors.text,
    backgroundColor: colors.card,
  },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.bg },
  emptyTitle: { fontSize: 16, color: colors.sub, textAlign: "center" },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  muted: { color: colors.sub, fontSize: 13 },
  title: { fontSize: 17, fontWeight: "700", color: colors.text },
  body: { fontSize: 15, color: colors.text },
});
