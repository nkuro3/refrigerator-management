import { useState } from "react";
import { Text } from "react-native";
import { Button, Card, ErrorText, Field, Screen, styles } from "../components/ui";
import { supabase } from "../lib/supabase";

export default function SignIn() {
  const [mode, setMode] = useState<"signIn" | "signUp">("signIn");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError(null);
    const { error } = mode === "signIn"
      ? await supabase.auth.signInWithPassword({ email: email.trim(), password })
      : await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: { data: { display_name: displayName.trim() } },
      });
    if (error) setError(new Error(error.message));
    setBusy(false);
  };

  return (
    <Screen>
      <Text style={[styles.title, { fontSize: 22 }]}>冷蔵庫</Text>
      <Text style={styles.muted}>家族で冷蔵庫の中身を共有して、使い切りを助けるアプリです。</Text>
      <Card>
        {mode === "signUp" && (
          <Field label="表示名（家族に見える名前）" value={displayName} onChangeText={setDisplayName} placeholder="例：パパ" />
        )}
        <Field label="メールアドレス" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" />
        <Field label="パスワード（6文字以上）" value={password} onChangeText={setPassword} secureTextEntry autoComplete="password" />
        <ErrorText error={error} />
        <Button
          title={mode === "signIn" ? "ログイン" : "アカウントを作成"}
          loading={busy}
          disabled={!email || password.length < 6 || (mode === "signUp" && !displayName.trim())}
          onPress={submit}
        />
        <Button
          title={mode === "signIn" ? "はじめての方はこちら" : "アカウントをお持ちの方はこちら"}
          variant="ghost"
          onPress={() => setMode(mode === "signIn" ? "signUp" : "signIn")}
        />
      </Card>
    </Screen>
  );
}
