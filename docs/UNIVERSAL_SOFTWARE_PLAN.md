# Universal software installation audit and plan

8 October 2026. Existing user changes and the previous remediation remain intact.
No downloads, live installations, destructive system changes, commits or pushes
are part of the audit. Installation execution always needs its own explicit
central approval; tests with controlled adapters are identified as such.

| Verified root cause                                                                                                              | Correction                                                                                                                             | Verification                                                                                     |
| -------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Astra replay stops at the first Winget error; Store also requires Winget                                                         | A provider registry evaluates all eligible sources and preserves individual failure diagnostics                                        | Missing manager, alternate offline/approved feed, all-source failure                             |
| Install/download admission creates an open-first one-app plan; versions, long names, update/reinstall/batch/OS download fall out | Separate generic software intent/query and bounded typed replay before desktop admission; download never implies install/launch        | Arbitrary names, versions/editions/architecture, batch, download-only and OS handoff             |
| Retry variants can exhaust ten chat steps before source fallback                                                                 | Bounded discovery inside the service; bounded per-product stages in replay                                                             | Step budget, declined approval, cancellation, no infinite retries                                |
| Winget sources are hardcoded and not discovered; no extensible provider interface                                                | Validated id/isAvailable/search/resolve adapters, runtime manager/source capabilities, approved feeds and offline repositories/cache   | New adapter registration without core resolver edits                                             |
| HTTPS and hostname similarity are treated as sufficient official-origin evidence                                                 | Independently approved origin/publisher anchors; untrusted search is a handoff, never an executable source                             | Unapproved origin, redirects, publisher mismatch, missing metadata and tamper rejection          |
| MSI identity reads PE metadata; package formats/deployment constraints missing                                                   | Format-specific metadata/capability validation and typed protocols; unsupported/OS workflows remain explicit user handoffs             | MSI/MSIX/APPX metadata, architecture/dependencies/capabilities and high-risk boundaries          |
| EXE direct spawn cannot reliably invoke normal UAC                                                                               | Code-owned Windows launch adapter with normal security prompts, fixed protocol arguments and captured result                           | Controlled runner tests, actual read-only metadata probes; no UAC bypass                         |
| Installer exit zero reports success despite empty inventory; classifier loses stdout                                             | Exact identity/version/publisher verification; unverified and reboot-pending states are truthful                                       | Exit-zero/no-inventory failure, controlled verified success, cancellation/timeout                |
| Network fetch ignores cancellation; plan IDs are volatile                                                                        | Combined timeout/cancel signals and persistent owned plan/cache records that revalidate before use                                     | Abort, restart, stale plan/source/digest denial                                                  |
| Approval is prose only and installation routes differ                                                                            | One SoftwareService through existing gate/ledger, contextual plan fields, operator-only trust enrollment and product-specific approval | Permission denial performs no work, route grants remain required, packaged real service contract |

Implementation stages:

1. Fix existing failure/false-success paths; add generic software intent and tests.
2. Add provider contracts/registry/resolver and immutable owned plans with offline,
   configured manager and approved publisher/release/internal repository adapters.
3. Wire the central service, safe installer executor, native source selection,
   trust registration and contextual UI into existing permission enforcement.
4. Run component/integration checks; build a fresh offline Windows release and
   execute the actual packaged service/resolver. Report live-install and external
   machine gaps rather than claiming they passed.

Model text may provide product requirements and owned IDs only. It cannot provide
executable commands, scripts, installer flags, trust grants, arbitrary download
URLs or plugin module paths. New executable provider code remains application
code; new trusted repositories are validated operator-approved data descriptors.
Website discovery and source authorization are separate decisions.
