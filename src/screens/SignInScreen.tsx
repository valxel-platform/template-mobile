import { useState } from "react";
import { useServices } from "../AppContext";
import { Body, Button, Notice, Screen, Title } from "../ui/components";

export function SignInScreen() {
  const { session } = useServices();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const signIn = async () => {
    setBusy(true);
    setFailed(false);
    try {
      await session.signIn();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Title>Sign in</Title>
      <Body muted>You sign in on your organization's page. This app never sees your password.</Body>
      {failed ? (
        <Notice tone="danger">Sign-in didn't finish. Check your connection and try again.</Notice>
      ) : null}
      <Button label="Sign in" busy={busy} onPress={() => void signIn()} />
    </Screen>
  );
}
