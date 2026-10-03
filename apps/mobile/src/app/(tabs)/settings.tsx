import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { router } from "expo-router";
import { Platform, Share, Switch, Text, View } from "react-native";
import { Button, Card, Chip, colors, ErrorText, Field, Screen, SectionTitle, styles } from "../../components/ui";
import { useAuth, useHousehold } from "../../lib/auth";
import { confirmAction } from "../../lib/confirm";
import { inviteMessage, inviteUrl } from "../../lib/invite";
import { enablePush, getPushStatus, type PushStatus, unregisterPushToken } from "../../lib/push";
import { useMembers } from "../../lib/queries";
import { supabase } from "../../lib/supabase";

const HOURS = [6, 7, 8, 9, 12, 18, 20];

const PUSH_MESSAGES: Record<Exclude<PushStatus, "native">, string> = {
  "needs-install": "iPhone で通知を受け取るには、Safari の共有ボタンから「ホーム画面に追加」し、ホーム画面のアイコンから開いてください。",
  default: "期限が近いものや家族による冷蔵庫の更新を、この端末に通知します。",
  granted: "この端末に通知が届きます。",
  denied: "通知がブロックされています。端末の設定（iPhone は 設定 → 通知）から許可してください。",
  unsupported: "このブラウザは通知に対応していません。",
};

export default function Settings() {
  const { profile, refresh } = useAuth();
  const household = useHousehold();
  const { data: members = [] } = useMembers();
  const [code, setCode] = useState<string | null>(null);
  const [name, setName] = useState(profile?.display_name ?? "");
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const pushStatus = useQuery({ queryKey: ["push-status"], queryFn: getPushStatus });
  const [enabling, setEnabling] = useState(false);

  const turnOnPush = async () => {
    setEnabling(true);
    setError(null);
    try {
      await enablePush();
    } catch (e) {
      setError(e);
    }
    await pushStatus.refetch();
    setEnabling(false);
  };

  const run = async (fn: () => PromiseLike<{ error: { message: string } | null }>) => {
    setError(null);
    setBusy(true);
    const { error } = await fn();
    if (error) setError(new Error(error.message));
    else await refresh();
    setBusy(false);
  };

  // 共有シート（Web では navigator.share）がなければクリップボードにコピーする
  const shareInvite = async (c: string) => {
    const message = inviteMessage(c);
    try {
      if (Platform.OS === "web" && !navigator.share) {
        await navigator.clipboard.writeText(message);
        window.alert("招待メッセージをコピーしました。LINE などに貼り付けて送ってください。");
        return;
      }
      await Share.share({ message });
    } catch {
      // 共有をキャンセルした場合など
    }
  };

  const invite = async () => {
    setError(null);
    const { data, error } = await supabase.rpc("create_invite");
    if (error) return setError(new Error(error.message));
    setCode(data as string);
  };

  return (
    <Screen>
      <Card>
        <SectionTitle>{household.name}</SectionTitle>
        {members.map((m) => (
          <Text key={m.user_id} style={styles.body}>
            {m.profiles?.display_name || "（名前なし）"}
            {m.role === "owner" ? "（作成者）" : ""}
          </Text>
        ))}
        {code ? (
          <View style={{ gap: 8 }}>
            <Text style={styles.muted}>招待コード（7日間有効）</Text>
            <Text style={{ fontSize: 28, fontWeight: "700", letterSpacing: 4 }} selectable>{code}</Text>
            <Text style={styles.muted} selectable>{inviteUrl(code)}</Text>
            <Button title="招待リンクを送る" variant="secondary" small onPress={() => void shareInvite(code)} />
          </View>
        ) : (
          <Button title="家族を招待する" variant="secondary" onPress={invite} />
        )}
      </Card>

      {pushStatus.data && pushStatus.data !== "native" && (
        <Card>
          <SectionTitle>通知</SectionTitle>
          <Text style={styles.muted}>{PUSH_MESSAGES[pushStatus.data]}</Text>
          {(pushStatus.data === "default" || pushStatus.data === "granted") && (
            <Button
              title={pushStatus.data === "granted" ? "この端末で通知を受け取っています" : "この端末で通知を受け取る"}
              variant={pushStatus.data === "granted" ? "secondary" : "primary"}
              small
              disabled={pushStatus.data === "granted"}
              loading={enabling}
              onPress={turnOnPush}
            />
          )}
        </Card>
      )}

      <Card>
        <SectionTitle>品目の管理</SectionTitle>
        <Text style={styles.muted}>品目の追加・編集や、別名（レシートの略称など）の登録ができます。</Text>
        <Button title="品目の一覧を開く" variant="secondary" small onPress={() => router.push("/items")} />
      </Card>

      <Card>
        <SectionTitle>使い切りアラートの時刻</SectionTitle>
        <Text style={styles.muted}>期限3日以内と解凍済みのものを、毎日この時刻に通知します。</Text>
        <View style={styles.wrap}>
          {HOURS.map((h) => (
            <Chip
              key={h}
              label={`${h}時`}
              selected={profile?.notify_hour === h}
              onPress={() => run(() => supabase.from("profiles").update({ notify_hour: h }).eq("user_id", profile!.user_id))}
            />
          ))}
        </View>
      </Card>

      <Card>
        <SectionTitle>冷蔵庫の更新通知</SectionTitle>
        <View style={[styles.row, { justifyContent: "space-between" }]}>
          <Text style={[styles.body, { flex: 1 }]}>家族が登録・使い切り・解凍などをしたら通知する</Text>
          <Switch
            value={profile?.notify_changes ?? true}
            disabled={busy}
            onValueChange={(v) => run(() => supabase.from("profiles").update({ notify_changes: v }).eq("user_id", profile!.user_id))}
            trackColor={{ true: colors.primary }}
          />
        </View>
        <Text style={styles.muted}>1分以内の操作は1通にまとめて届きます。自分の操作は通知されません。</Text>
      </Card>

      <Card>
        <SectionTitle>表示名</SectionTitle>
        <Field label="家族に見える名前" value={name} onChangeText={setName} />
        <Button
          title="保存"
          small
          loading={busy}
          disabled={!name.trim() || name === profile?.display_name}
          onPress={() => run(() => supabase.from("profiles").update({ display_name: name.trim() }).eq("user_id", profile!.user_id))}
        />
      </Card>

      <ErrorText error={error} />
      <Button
        title="ログアウト"
        variant="danger"
        onPress={() =>
          confirmAction("ログアウトしますか？", "ログアウト", () => {
            void unregisterPushToken().finally(() => supabase.auth.signOut());
          })}
      />
    </Screen>
  );
}
