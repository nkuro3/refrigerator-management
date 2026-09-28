import { useState } from "react";
import { Text } from "react-native";
import { Button, Card, ErrorText, Field, Screen, SectionTitle, styles } from "../components/ui";
import { useAuth } from "../lib/auth";
import { supabase } from "../lib/supabase";

export default function Onboarding() {
  const { refresh } = useAuth();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState<"create" | "join" | null>(null);

  const run = async (kind: "create" | "join") => {
    setBusy(kind);
    setError(null);
    const { error } = kind === "create"
      ? await supabase.rpc("create_household", { p_name: name.trim() })
      : await supabase.rpc("join_household", { p_code: code.trim() });
    if (error) {
      setError(new Error(error.message.includes("invalid") ? "招待コードが正しくないか、期限が切れています" : error.message));
    } else {
      await refresh();
    }
    setBusy(null);
  };

  return (
    <Screen>
      <Text style={styles.muted}>在庫は「世帯」の単位で家族と共有します。</Text>
      <Card>
        <SectionTitle>招待コードで参加する</SectionTitle>
        <Text style={styles.muted}>家族がすでに世帯を作っている場合は、設定画面の招待コードを教えてもらってください。</Text>
        <Field label="招待コード" value={code} onChangeText={setCode} autoCapitalize="characters" placeholder="例：K7MQ2XWP" />
        <Button title="参加する" loading={busy === "join"} disabled={code.trim().length < 8} onPress={() => run("join")} />
      </Card>
      <Card>
        <SectionTitle>新しく世帯を作る</SectionTitle>
        <Field label="世帯の名前" value={name} onChangeText={setName} placeholder="例：黒田家" />
        <Button title="作成する" variant="secondary" loading={busy === "create"} disabled={!name.trim()} onPress={() => run("create")} />
      </Card>
      <ErrorText error={error} />
    </Screen>
  );
}
