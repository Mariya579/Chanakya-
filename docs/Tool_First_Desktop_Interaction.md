# Tool-first desktop interaction

The previous application registry could launch an app but could not operate its interface. Calculator requests could therefore fall through to a model-generated answer telling the user to enter values manually.

## Implemented

- `backend/src/orchestrator/ComputerTaskPolicy.js` recognizes common computer-action requests. Calculator, simple app opening, and Notepad typing produce deterministic tool proposals without asking the model to decide whether to act.
- `backend/src/routes/chat.js` suppresses ordinary model prose for recognized computer requests. Missing tools and models without tool support return an explicit blocked outcome. Current-turn UI evidence is required before an interaction is reported as completed. Older conversation tool results cannot satisfy a new request.
- `frontend/tools/services/UIAutomationService.js` provides `uiAutomation.calculate({expression})` and `uiAutomation.typeInNotepad({text})`, using the existing AppService, registry, ProcessService, authentication, permissions, and execution ledger.
- `frontend/tools/apps/InteractWithApp.ps1` identifies the running application using its actual Windows AUMID. Calculator controls are invoked by AutomationId and the display is read back and checked. Notepad writes only into an empty editor and reads the text back. Input travels as JSON on stdin, never as shell code or global keystrokes.
- Planner, capability validation, deterministic verifier, model policy, ToolRegistry, and bridge timeout support the new UI actions. App launch success alone cannot satisfy a UI interaction.

## Verified

- Real Calculator UI: `1+1` entered through its buttons; displayed result `2` read and verified. The explicit Windows integration test passed again after the retry.
- Real Notepad UI: `Hello` entered into an empty editor and read back. Existing nonempty editors were not replaced. The test left the text visible; it did not save a file.
- Backend suite: 525 passed, zero failures.
- Tool Engine suite: 121 passed, zero failures, three opt-in integration tests skipped. The Calculator integration was run separately and passed.
- Frontend production build passed, with the existing bundle-size warning.
- HTTP regression tests verify deterministic tool dispatch, missing-tool blocking, and truthful final responses for both successful and failed UI operations.

## Scope and limitations

This is a bounded UI automation implementation, not unrestricted control of every application. It supports Microsoft packaged Calculator binary arithmetic with two nonnegative decimal operands and `+`, `-`, `*`, `/`; and Microsoft packaged Notepad empty-editor typing. Unsupported application identities, controls, modes, arithmetic, permissions, and ambiguous windows produce failure/blocked outcomes. Arbitrary clicks, scripts, global keyboard injection, elevated UI, destructive controls, and overwriting existing documents are not exposed.

Generic app launching remains dynamically discovered. Opening VS Code works through the registry, but opening an arbitrary project inside its UI does not yet have a dedicated verified adapter. The action recognizer covers common English requests; it is not a complete multilingual natural-language intent classifier. Prompt guidance also instructs the model to use tools for computer work, but this must not be represented as a formal guarantee for every possible phrasing.

The UI adapter uses Microsoft's [UI Automation element API](https://learn.microsoft.com/en-us/dotnet/api/system.windows.automation.automationelement.findfirst?view=windowsdesktop-10.0). Calculator output is taken from the application, not supplied from model arithmetic.

Source and the frontend web build were updated. Restart the development Electron app and backend to load them. An already-installed desktop executable does not receive source edits automatically; this task has not rebuilt or installed a Windows release. No Git commit/push/reset/checkout/rebase was performed.
