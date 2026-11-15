# Universal software discovery and installation — 9 October 2026

The installation flow now uses a generic provider registry, independently approved
source policies, typed owned plans and the existing central permission engine.
No application-name list controls installation routing. Development and actual
packaged application verification have passed; final delivery evidence is below.
No Git commits/pushes, dependency downloads, live software installations or OS
changes were performed during development.

## Root causes corrected

The audit and staged plan were saved before implementation in
[UNIVERSAL_SOFTWARE_PLAN.md](/E:/chatbot/docs/UNIVERSAL_SOFTWARE_PLAN.md).

| Failure                                       | Root cause                                                                                                 | Correction                                                                                                                                                  |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Missing Winget stopped installation           | Astra returned immediately after the first manager failure; Store also used Winget                         | Shared provider discovery evaluates eligible sources and retains individual failure diagnostics; official Store handoff works without assuming Winget       |
| Unknown/versioned/long names missed the agent | Installation admission reused a short application-launch parser                                            | Separate generic SoftwareTask admission preserves product, operation, publisher, version, edition, architecture, source and OS scope                        |
| Download could install/open                   | Astra conflated download, install and application launch                                                   | Independent download-only replay; no automatic install or launch                                                                                            |
| Batch silently kept one application           | A single open-first plan represented the whole request                                                     | Up to eight products run sequentially, each with separate plan, approvals and independent verification; failure/refusal stops the remainder                 |
| Fallback exhausted its budget                 | Twelve typo variants preceded alternatives in a ten-step loop                                              | Bounded source searches, typed replay and a 48-action budget; no app-specific retry tree                                                                    |
| Untrusted websites appeared official          | Hostname similarity and HTTPS were treated as authority                                                    | Appearance never grants trust; approved exact origins, publisher anchors and optional certificate pins are enforced by backend components                   |
| Exit zero reported installation success       | Winget/Web returned success despite empty inventory; Winget passed stdout under the wrong classifier field | Exact fresh identity/publisher/version verification; unverified, cancelled, timed-out, pending-restart and uncertain results remain failures/pending states |
| MSI identity was unreliable                   | PE VersionInfo was used for MSI products                                                                   | Native Windows Installer database metadata; MSIX/APPX manifests and EXE signature/PE/manifest metadata                                                      |
| UAC/cancellation were unreliable              | Direct process spawn did not establish normal ShellExecute behavior; some fetches ignored request signals  | Fixed application-owned Windows protocols, normal UAC, owned helper cancellation, combined deadlines and bounded concurrency                                |
| Plans/cache vanished or changed               | Handles were volatile; cache discovery depended on 24-hour plan expiry                                     | Persistent account-owned MAC-protected records, DPAPI-protected key, separate long-lived cache manifests and fresh cache hash/signature checks              |
| Cleanup hid the security rejection            | A transient Windows quarantine lock replaced an identity error with ENOTEMPTY                              | Bounded cleanup retry preserves the original rejection; inaccessible private staging never becomes executable authority                                     |

## Provider interface and extension

The runtime interface is implemented in
[contracts.d.ts](/E:/chatbot/frontend/tools/software/contracts.d.ts) and validated
by [ProviderRegistry.js](/E:/chatbot/frontend/tools/software/ProviderRegistry.js):

```typescript
interface SoftwareSourceProvider {
  id: string;
  capabilities: { offline: boolean; network: boolean };
  descriptor: object;
  isAvailable(): Promise<boolean>;
  search(query: SoftwareQuery): Promise<SoftwareCandidate[]>;
  resolve(candidate: SoftwareCandidate): Promise<InstallerPlan>;
}
```

Trusted application code can register a new adapter with
`registry.register(adapter, {trusted: true})` without modifying the resolver or
installation agent. Model text cannot register/import executable provider code.
Users can enroll validated data descriptors through **Settings → Software** and
an explicit source-authorization approval. Supported descriptor kinds are:

- `json-feed`: publisher or enterprise catalog with structured product metadata.
- `release-api`: authorized release metadata plus a separately approved product
  identity; version templates remain within exact approved hosts.
- `local-repository`: selected installer folder with approved publishers and
  fresh native inspection; symlinks/junction ancestors and escapes are rejected.
- `official-page`: authorized user-assisted distribution/deployment interface.
- `package-repository`: explicit publisher/origin authorization for a discovered
  configured WinGet repository.

Default discovery inspects actual manager registrations, executable signature,
version and configured repository exports. The shipped automatic manager adapter
is WinGet. Other detected managers receive an actionable unsupported-protocol
diagnostic; no guessed shell workflow executes them. Approved offline cache/local
repositories, JSON feeds, release APIs and official pages provide independent
alternatives. A configured repository name alone does not make its origin trusted.

Example feed shape (all product values are runtime data, never special routing):

```json
{
  "schemaVersion": 1,
  "products": [
    {
      "id": "publisher-product-id",
      "name": "Actual published product name",
      "publisher": "Approved publisher",
      "version": "2.1.0",
      "architecture": "x64",
      "platform": { "os": "windows", "minimumVersion": "10.0.19041" },
      "installer": {
        "format": "exe",
        "url": "https://approved.example/installer.exe",
        "sha256": "published-64-hex-digest"
      },
      "privileges": "user",
      "license": { "required": false },
      "reboot": "possible",
      "dependencies": []
    }
  ]
}
```

The illustrative digest must be replaced with the actual published SHA-256.
Feeds cannot supply arbitrary arguments, commands, remote scripts or module paths.
API bearer credentials are protected locally and are not exposed to the model.
Credentials in source URL query fields are rejected. Authentication is forwarded
only to the initially authorized origin, not another redirect host.

## Resolver, trust and approval

SoftwareResolver ranks verified source results by identity and constraints,
deduplicates equivalent products, and asks the user when plausible identities or
publishers differ. A top-ranked typo/name result is insufficient for automatic
selection. Download, update and installation use the same resolver.

The shared SoftwareService exposes typed `providers`, `discover`,
`discoverOnline`, `resolve`, `download`, `install` and `verify` actions. Model calls
contain software requirements or opaque candidate/plan IDs. Installation/source
management remains behind authenticated IPC, signed Windows-route proposals,
central risk classification, exact task/account/parameter binding, single-use
approval and the existing audit ledger. General chat cannot acquire OS authority.

Offline lookup performs no online catalog search. Online discovery requires a
separate contextual approval. Native distribution plans download and inspect
before a fresh installation approval, so the dialog can show actual publisher,
version, size, hash, privileges, edition, license/payment and reboot information.
Download approval does not authorize execution; installation approval authorizes
only the exact owned product plan. Changed hashes, pins, publisher, source,
architecture, privilege/capabilities or plan digest fail closed.

HTTPS redirects must stay within exact approved hosts. DNS is checked and pinned;
loopback/link-local/cloud-metadata/reserved addresses are denied. RFC1918/ULA
addresses are permitted only for explicitly approved enterprise sources with TLS.
Repository credentials, source policies and plan ownership are isolated by account.

Local executables, MSI, MSIX/APPX and bundles receive format-specific inspection.
Generic EXE execution uses normal Windows ShellExecute/UAC. MSI and app-package
deployment use fixed code-owned protocols, without model-supplied switches. WinGet
installation uses interactive publisher licensing/security interfaces and does not
automatically accept package license agreements. Payment, account login, activation
and organizational entitlement remain controlled by the user.

Fresh native uninstall/AppX inventory verifies exact product identity, publisher
and version, independently of launchability or shortcut presence. An exact version
already installed returns ALREADY_INSTALLED without running an installer. Exit
zero without matching inventory returns INSTALL_UNVERIFIED. Reboot and uncertain
execution are not reported as installation completion. One installation and two
downloads can be active; discovery searches at most three providers concurrently.

Operating-system media is download/handoff only, with approved metadata and
published checksum. Upgrade, format, partition, boot-media and activation bypass
operations are not executed by this installation agent.

## Modified files

- `backend/src/orchestrator/SoftwareTask.js`, `SoftwareRunner.js`,
  `ComputerTaskPolicy.js`, `TaskRouter.js`, `AstraTask.js`, `AstraRunner.js`,
  `OrchestratorPlanner.js`, `AgentOrchestrator.js`, `Verifier.js`,
  `CapabilityContracts.js`, and `backend/src/routes/chat.js`.
- `frontend/tools/services/SoftwareService.js`, `WingetService.js`,
  `WebInstallService.js`; `frontend/tools/software/*` and `providers/*`.
- `frontend/tools/ToolEngineRouter.js`, `security/ToolRegistry.js`,
  `ToolRequestValidator.js`, `repair/contract.js`; legacy installer tools are
  retired from model capability selection in favor of the shared facade.
- `frontend/electron/services/SoftwareKey.js`, `ipc/tool.ipc.js`, `preload.cjs`.
- `frontend/src/settings/SoftwareSourcesPanel.jsx`, `SettingsPanel.jsx`,
  `OfflineInstallerControls.jsx`, `stores/useNavStore.js`, `useAppStore.js`,
  `components/SoftwareChoiceModal.jsx`, `ConfirmationModal.jsx`, `App.jsx`,
  `services/api.js`, `chatExecution.js`, and `utils/attachments.js`.
- `frontend/scripts/validate-security-package.cjs`,
  `scripts/software-acceptance.mjs`, and software flow/provider/executor/native
  metadata/service tests. Existing unrelated edits and user data were preserved.

## Verification

| Test                                                                | Verified result                                                                                                                                                                                                                                      |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Working-tree regression suite with native metadata enabled          | **420 passed, 0 failed, 0 skipped**; [component-tests.txt](/E:/chatbot/docs/software-verification/component-tests.txt)                                                                                                                               |
| Frozen release-source regression suite with native metadata enabled | **432 passed, 0 failed, 0 skipped**, including concurrent model-registry tests preserved in the snapshot; [snapshot-tests.txt](/E:/chatbot/docs/software-verification/snapshot-tests.txt)                                                            |
| Actual Windows MSI/MSIX fixture inspection without execution        | **2 passed**; [native-metadata.txt](/E:/chatbot/docs/software-verification/native-metadata.txt)                                                                                                                                                      |
| Real Electron sender trust/navigation assertions                    | **8 passed**; [electron-tests.txt](/E:/chatbot/docs/software-verification/electron-tests.txt)                                                                                                                                                        |
| Development Electron software flow                                  | **20/20 passed**; [development-acceptance.json](/E:/chatbot/docs/software-verification/development-acceptance.json)                                                                                                                                  |
| Frozen packaged binary, executed before delivery copy               | **20/20 passed**; [snapshot-packaged-acceptance.json](/E:/chatbot/docs/software-verification/snapshot-packaged-acceptance.json)                                                                                                                      |
| Delivered packaged EXE, executed from final release folder          | **20/20 passed**, 0 renderer errors, 0 downloads, 0 installer executions; [packaged-acceptance.json](/E:/chatbot/docs/software-verification/packaged-acceptance.json), [UI screenshot](/E:/chatbot/docs/software-verification/packaged-software.png) |
| Delivered source integrity, repair and portability                  | **113 security files match the frozen source**, repair digest passed, **17,234 resource files checked**, no packaged user storage or unverified links; [package-validation.json](/E:/chatbot/docs/software-verification/package-validation.json)     |
| File-by-file delivery comparison                                    | **17,308 files match the frozen application exactly**; installer SHA-256 also matches its original build output                                                                                                                                      |

Controlled-adapter tests demonstrate unknown fixture software, new adapter
registration, successful verified installation state, exit-zero/empty-inventory
failure, cancellation, timeout, changed identity/hash, missing managers, alternate
sources, source failures, ambiguity, multi-product refusal and version/dependency
constraints. Controlled runner success is not evidence of a live native install.

The development and packaged UI tests read a real signed runtime program, approved a new
repository only in an isolated QA profile, resolved its identity with the generic
provider, declined installation and online lookup, and restored the provider/owned
plan after app restart. The program was copied/inspected only and was never run as
an installer. The signed chat-to-software request and refusal were also exercised.

Two initial release attempts were rejected by source-integrity checks because
files changed during packaging. Those outputs are not the delivered release.
The final build uses `E:\chatbot\.qa\software-release-source-20261009`, captured
at `2026-10-09T13:18:56.521Z`. Its 366 production source files are recorded in
[source-snapshot.json](/E:/chatbot/docs/software-verification/source-snapshot.json)
and were rehashed without discrepancies. Existing model-router and UI changes
were preserved; the working checkout was not reset or overwritten. Dependency
bytes came from the existing offline runtime. Snapshot packaging dereferenced
the dependency junction when copying runtime files, and portability validation
checked the resulting files for leaked links, user data and machine-bound paths.

## Remaining limitations

- No live software installation/download, clean Windows VM, real UAC approval,
  store login/purchase, licensed-product activation or OS deployment was performed.
- The build is unsigned; a production signing certificate was not supplied.
- Automatic manager execution is supplied for independently signed WinGet; other
  detected managers need a trusted adapter or user-assisted interface.
- Publisher websites without independently approved origin/publisher metadata use
  official-page/manual handoff. Website appearance never authorizes execution.
- MSIX/APPX bundle nested capabilities/dependencies cannot yet be fully inspected;
  uncertain bundles are refused/user-assisted. Unresolved dependencies require
  their own product review. Generic reinstall needs independent provider repair
  evidence, otherwise it safely hands off.
- Local repositories inspect direct installer files (bounded at 100); broad folder
  recursion is not an installation-provider behavior. Catalogs/queries are bounded.
- WinGet console identity parsing has an English fallback; unsupported locale or
  incomplete payload metadata produces diagnostics and alternate-source/handoff.
- Backend orchestration emits a safe software-choice stop; interactive selection
  and resume are implemented in Chat. Large batches may reach the action limit;
  completed products remain truthfully reported.
- Existing avatar/voice chunk-size and asar:false warnings remain unrelated to
  this installer architecture. No universal automation or source availability is
  promised when verified metadata is unavailable.

## Reproduction

From `E:\chatbot`, using already installed dependencies:

```powershell
$env:CHANAKYA_NATIVE_METADATA_TEST='1'
npm test
npm run test:electron
node scripts/software-acceptance.mjs
npm run electron:release -w frontend -- --output-dir=release-software-next
```

Release commands use a fresh output and existing offline dependencies. They do
not overwrite prior releases, package user data, publish, or implicitly download.

## Release artifacts

The final offline build exited **0** using this command in
`E:\chatbot\.qa\software-release-source-20261009\frontend`:

```powershell
node scripts/build-release.cjs --output-dir=release-software-20261009
```

The resulting files were copied into a fresh delivery folder:

- [Windows installer](</E:/chatbot/frontend/release-software-20261009-verified/Chanakya AI Setup 1.0.0.exe>): 296,819,948 bytes, SHA-256 `311917f448cca72ff5fc547facbed14d1be835b5705f4c4cc05923671c0ad8ee`.
- [Packaged application](</E:/chatbot/frontend/release-software-20261009-verified/win-unpacked/Chanakya AI.exe>): 204,521,984 bytes, SHA-256 `efe492382b9ffb57f18ebb5ebc52db10b1994674ac6efa2ae24dce0c42caf351`.
- [Build and signing receipt](/E:/chatbot/docs/software-verification/release-artifacts.json).

Windows Authenticode reports **NotSigned** for both files. Application code lives
in `resources`, so the Electron executable hash alone does not identify the
software implementation; source integrity and delivered resource-tree checks
are recorded separately. The setup program was built and hashed, but was not
installed. Testing uses the actual packaged application in an isolated QA profile.
The delivered application tree has SHA-256
`c0c1fe2ec4624e9815189e6e4948b9d63ba56c3d62ce3435e0168169316b3357`
over its sorted relative-path/file-hash manifest; it matches the frozen build
file by file. The repaired administrator capability still requires its normal
runtime ACL check after installation; packaging does not certify that ACL.

The delivered executable was run with this command from `E:\chatbot`; all 20
checks passed, including generic unknown-product resolution through a newly
approved local provider, signed chat admission, independent native inventory,
declined installation/network approvals, and persistence across restart:

```powershell
node scripts/software-acceptance.mjs '--exe=E:\chatbot\frontend\release-software-20261009-verified\win-unpacked\Chanakya AI.exe'
```
