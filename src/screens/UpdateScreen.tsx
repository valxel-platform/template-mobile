import { Linking, Platform } from "react-native";
import { Body, Button, Screen, Title } from "../ui/components";

/** Store pages: set them for the product's app (App Store id, Play package). */
export const STORE_URL = Platform.select({
  ios: "itms-apps://apps.apple.com/app/id0000000000",
  default: "market://details?id=com.vrixel.template",
});

/** The BFF answered 426: this version is older than the oldest the API still supports. */
export function UpdateScreen() {
  return (
    <Screen>
      <Title>Update the app</Title>
      <Body muted>
        This version is no longer supported. Update it from the store to keep working. Changes you made are
        kept and sent after the update.
      </Body>
      <Button label="Open the store" onPress={() => void Linking.openURL(STORE_URL)} />
    </Screen>
  );
}
