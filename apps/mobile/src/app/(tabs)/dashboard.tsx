import { isAlertTarget, monthRange, shiftMonth, sortByUrgency, todayJst } from "@fridge/shared";
import { router } from "expo-router";
import { useState } from "react";
import { RefreshControl, ScrollView, Text, View } from "react-native";
import { ProductRow } from "../../components/ProductRow";
import { Button, Card, colors, ErrorText, SectionTitle, styles } from "../../components/ui";
import { useActiveProducts, useDashboardSummary } from "../../lib/queries";

function StatTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <View style={{ flex: 1, gap: 4 }}>
      <Text style={styles.muted}>{label}</Text>
      <Text style={{ fontSize: 26, fontWeight: "700", color: colors.text }}>{value}</Text>
      {sub ? <Text style={styles.muted}>{sub}</Text> : null}
    </View>
  );
}

export default function Dashboard() {
  const today = todayJst();
  const [month, setMonth] = useState(today.slice(0, 7));
  const { from, to } = monthRange(month);
  const products = useActiveProducts();
  const summary = useDashboardSummary(from, to);

  const alerts = sortByUrgency((products.data ?? []).filter((p) => isAlertTarget(p, today)), today);
  const s = summary.data;
  const endedCount = s ? s.used_up_count + s.discarded_count : 0;
  const [y, m] = month.split("-");

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{ paddingVertical: 16, gap: 16, paddingBottom: 48 }}
      refreshControl={
        <RefreshControl
          refreshing={products.isRefetching || summary.isRefetching}
          onRefresh={() => { void products.refetch(); void summary.refetch(); }}
        />
      }
    >
      <View style={{ paddingHorizontal: 16, gap: 8 }}>
        <SectionTitle>使い切りたいもの（解凍済み・期限3日以内）</SectionTitle>
      </View>
      <View>
        {alerts.length === 0 ? (
          <Text style={[styles.muted, { paddingHorizontal: 16 }]}>期限が近いものはありません。</Text>
        ) : (
          alerts.map((p) => (
            <ProductRow key={p.id} product={p} today={today} onPress={() => router.push({ pathname: "/product/[id]", params: { id: p.id } })} />
          ))
        )}
      </View>

      <View style={{ paddingHorizontal: 16, gap: 12 }}>
        <View style={[styles.row, { justifyContent: "space-between" }]}>
          <Button title="‹" variant="ghost" small onPress={() => setMonth(shiftMonth(month, -1))} accessibilityLabel="前の月" />
          <Text style={styles.title}>{y}年{Number(m)}月のフードロス</Text>
          <Button
            title="›"
            variant="ghost"
            small
            disabled={month >= today.slice(0, 7)}
            onPress={() => setMonth(shiftMonth(month, 1))}
            accessibilityLabel="次の月"
          />
        </View>
        <ErrorText error={summary.error} />
        {s && (
          <>
            <Card>
              <View style={styles.row}>
                <StatTile label="捨てた金額" value={`${Number(s.discarded_amount).toLocaleString()}円`} sub="価格のわかる商品のみ" />
                <StatTile label="捨てた数" value={`${s.discarded_count}点`} />
              </View>
            </Card>
            <Card>
              <StatTile
                label="使い切り率"
                value={s.used_up_rate === null ? "—" : `${Math.round(Number(s.used_up_rate) * 100)}%`}
                sub={`使い切った ${s.used_up_count}点 ／ 終了した ${endedCount}点`}
              />
              {s.used_up_rate !== null && (
                <View
                  accessibilityRole="progressbar"
                  accessibilityValue={{ min: 0, max: 100, now: Math.round(Number(s.used_up_rate) * 100) }}
                  style={{ height: 8, borderRadius: 4, backgroundColor: colors.border, overflow: "hidden" }}
                >
                  <View style={{ width: `${Number(s.used_up_rate) * 100}%`, height: 8, borderRadius: 4, backgroundColor: colors.primary }} />
                </View>
              )}
            </Card>
            {s.discarded_count > 0 && (
              <Card>
                <SectionTitle>捨てた理由</SectionTitle>
                <Text style={styles.body}>期限切れ {s.expired_count}点・傷み {s.spoiled_count}点・その他 {s.other_count}点</Text>
              </Card>
            )}
          </>
        )}
      </View>
    </ScrollView>
  );
}
