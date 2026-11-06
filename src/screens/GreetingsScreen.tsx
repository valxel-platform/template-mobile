/**
 * The example feature: read a greeting (online) and save one (works offline: the change waits in
 * the outbox until the API accepts it). Replace it with the product's first screen.
 */
import { Link } from "expo-router";
import { useState } from "react";
import { saveGreeting } from "../api/client";
import { ApiError, Offline } from "../api/http";
import { useOutbox, useServices } from "../AppContext";
import { Body, Button, Card, Field, Heading, Notice, Screen, Title } from "../ui/components";

const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

export function slug(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

export function GreetingsScreen() {
  const { api, outbox, session } = useServices();
  const waiting = useOutbox();
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [greeting, setGreeting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const who = session.claims;

  const look = async () => {
    setBusy(true);
    setError(null);
    try {
      setGreeting((await api.greeting(name.trim())).message);
    } catch (e) {
      setGreeting(null);
      setError(
        e instanceof Offline
          ? "No connection. Try again when you're back online."
          : e instanceof ApiError
            ? (e.detail ?? e.title)
            : "Something went wrong.",
      );
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    const id = slug(name);
    if (!ID.test(id) || !message.trim()) {
      setError("Enter a name and a message.");
      return;
    }
    setError(null);
    await outbox.enqueue(saveGreeting(id, { name: name.trim(), message: message.trim() }));
    setMessage("");
  };

  const problems = waiting.filter((c) => c.state !== "pending").length;

  return (
    <Screen>
      <Title>Greetings</Title>
      {who?.name || who?.preferred_username ? (
        <Body muted>Signed in as {who.name ?? who.preferred_username}</Body>
      ) : null}

      {waiting.length > 0 ? (
        <Link href="/changes" accessibilityRole="link">
          <Body>
            {problems > 0
              ? `${String(problems)} change${problems === 1 ? "" : "s"} need${problems === 1 ? "s" : ""} your attention`
              : `${String(waiting.length)} change${waiting.length === 1 ? "" : "s"} waiting to send`}
          </Body>
        </Link>
      ) : null}

      <Field label="Name" value={name} onChangeText={setName} autoCapitalize="words" autoCorrect={false} />
      <Field label="Message" value={message} onChangeText={setMessage} />
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <Button label="Save greeting" onPress={() => void save()} />
      <Button
        label="Get greeting"
        kind="secondary"
        busy={busy}
        disabled={!name.trim()}
        onPress={() => void look()}
      />

      {greeting ? (
        <Card>
          <Heading>{greeting}</Heading>
        </Card>
      ) : null}

      <Button label="Sign out" kind="secondary" onPress={() => void session.signOut()} />
    </Screen>
  );
}
