import { useState } from "react";
import { Alert, Share, Text, View } from "react-native";
import { Button, Card, Chip, ErrorText, Field, Screen, SectionTitle, styles } from "../../components/ui";
import { useAuth, useHousehold } from "../../lib/auth";
import { unregisterPushToken } from "../../lib/push";
import { useMembers } from "../../lib/queries";
import { supabase } from "../../lib/supabase";

const HOURS = [6, 7, 8, 9, 12, 18, 20];

export default function Settings() {
  const { profile, refresh } = useAuth();
  const household = useHousehold();
  const { data: members = [] } = useMembers();
  const [code, setCode] = useState<string | null>(null);
  const [name, setName] = useState(profile?.display_name ?? "");
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => PromiseLike<{ error: { message: string } | null }>) => {
    setError(null);
    setBusy(true);
    const { error } = await fn();
    if (error) setError(new Error(error.message));
    else await refresh();
    setBusy(false);
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
            <Button title="コードを送る" variant="secondary" small onPress={() => Share.share({ message: `冷蔵庫アプリの招待コード: ${code}` })} />
          </View>
        ) : (
          <Button title="家族を招待する" variant="secondary" onPress={invite} />
        )}
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
          Alert.alert("ログアウトしますか？", undefined, [
            { text: "キャンセル", style: "cancel" },
            { text: "ログアウト", style: "destructive", onPress: () => void unregisterPushToken().finally(() => supabase.auth.signOut()) },
          ])}
      />
    </Screen>
  );
}
