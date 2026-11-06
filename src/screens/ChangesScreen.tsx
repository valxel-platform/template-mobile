/** Changes made on this device that the API hasn't accepted yet, and what the person can do. */
import { useOutbox, useServices } from "../AppContext";
import type { Command } from "../outbox/outbox";
import { Body, Button, Card, Heading, Notice, Screen, Title } from "../ui/components";

function status(command: Command): string {
  if (command.state === "conflict") return "Someone else changed this first.";
  if (command.state === "rejected") return "Not accepted.";
  return command.attempts === 0 ? "Sending…" : "Waiting for a connection.";
}

export function ChangesScreen() {
  const { outbox } = useServices();
  const commands = useOutbox();
  return (
    <Screen>
      <Title>Waiting changes</Title>
      {commands.length === 0 ? <Body muted>Everything is sent.</Body> : null}
      {commands.map((command) => (
        <Card key={command.id}>
          <Heading>{command.label}</Heading>
          <Body muted>{status(command)}</Body>
          {command.problem ? (
            <Notice tone={command.state === "conflict" ? "warning" : "danger"}>{command.problem}</Notice>
          ) : null}
          {command.state === "pending" ? null : (
            <>
              <Button label="Send again" onPress={() => void outbox.retry(command.id)} />
              <Button
                label="Discard change"
                kind="secondary"
                onPress={() => void outbox.discard(command.id)}
              />
            </>
          )}
        </Card>
      ))}
    </Screen>
  );
}
