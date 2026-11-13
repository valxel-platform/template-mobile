# Contributing

1. Branch from `main` (`feature/<FEATURE-ID>` when the Valxel SDLC opens it for you).
2. Keep pull requests small and focused; one concern each.
3. Write commits in the imperative ("Add consent lookup"); reference the feature or work item.
4. Run the checks locally before pushing (see the README's "Develop" section).
5. A pull request merges when its required checks and the Valxel SDLC's gates (`valxel/gates`)
   pass. The default branch accepts pull requests only.

Changes to APIs follow expand, then contract: add the new shape, migrate consumers, then remove
the old one in a later release. Contract tests protect consumers in between. For this app "later"
means once no supported version uses the old shape: store builds stay installed for months, so the
BFF's minimum supported version (`BFF_MOBILE_MIN_VERSION`) must pass the version that stopped
using it first.
