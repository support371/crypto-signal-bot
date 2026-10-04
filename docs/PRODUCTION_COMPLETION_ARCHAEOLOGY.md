# Repository archaeology — 2026-10-04

Baseline main: `70ec4e396f64a69cac46eab8e260ac5a6e6a50c7`.

Inventory: 199 remote branches, 226 PRs (6 open, 142 merged), no tags or releases. All branch trees and 1,155 distinct differing blobs indexed; all PR changed-file histories retrieved. This is a source inventory, not proof of runtime activation.

User master assignment supersedes the old permanent paper endpoint in AGENTS.md. Existing certification artifacts retain their locks; activation requires a separate verified production release.

## Capability matrix before changes

| Capability | Classification | Strongest existing evidence | Remaining integration |
|---|---|---|---|
| Supabase authentication | PRODUCTION_WIRED | src/context/AuthProvider.tsx; worker/src/management.ts | Project reports INACTIVE; runtime authentication unverified |
| RBAC and step-up | IMPLEMENTED_NOT_WIRED | worker/src/live/authorization.ts; migration 010; PR #167 server gateway | Bind trusted sessions to live authority |
| Guardian hierarchy / risk | IMPLEMENTED_NOT_WIRED | live/guardian.ts; risk-engine.ts; bitget-candidate-gate-chain.ts | Candidate chain exists; provider dispatch disconnected |
| Feed integrity | PARTIALLY_IMPLEMENTED | fast-path/feed-health.ts; freshness.ts; PRs #125/#131; merged replacement | Shadow registry exists; no production gateway/authority |
| Product normalization and order rules | IMPLEMENTED_NOT_WIRED | live/product-rules.ts; adapters/bitget/normalizer.ts; preview.ts | Certified rules must reach authoritative order submission |
| Idempotency | PARTIALLY_IMPLEMENTED | live/idempotency.ts; migration 004; candidate-evidence.ts; paper reserve-first claim | Live submission claim not wired |
| Account coordinator / outbox | IMPLEMENTED_NOT_WIRED | live/observed-account-coordinator.ts; account-coordinator.ts; wrangler.live-candidate.toml | Candidate resources use placeholders; execution locked |
| Order lifecycle | IMPLEMENTED_NOT_WIRED | live/domain.ts; order-state-machine.ts; reconciliation.ts | Provider acknowledgements and cancellation not wired |
| Bitget signed demo transport | IMPLEMENTED_NOT_WIRED | adapters/bitget/demo-write-transport.ts; demo-certification-composition.ts | No deployed demo runner or external certification |
| Bitget read-only contracts / recovery | IMPLEMENTED_NOT_WIRED | adapters/bitget/read-only-client.ts; recovery.ts; user-stream.ts | Existing GET-only client needs runtime composition |
| Recovery discovery / lookup plan | IMPLEMENTED_NOT_WIRED | recovery-scan.ts; recovery-reconciliation-plan.ts; merged #223/#225/#227 | Only authenticated manual read route, no controlled schedule |
| Attested recovery cycle | IMPLEMENTED_NOT_WIRED | bitget-recovery-cycle.ts; merged #230 supersedes #229 | Consumes snapshot, does not perform GET or project state |
| Recovery accounting approval / dispatch | IMPLEMENTED_NOT_WIRED | recovery-accounting-fresh-dispatch-orchestrator.ts; migrations 018–020 | Internal executor needs certified source and scoped authority |
| Fill lots / fees / P&L / journals | IMPLEMENTED_NOT_WIRED | fill-accounting.ts; fill-accounting-store.ts; fill-accounting-reconciliation.ts | Internal coordinator paths; not end-to-end provider connected |
| Reservation settlement | IMPLEMENTED_NOT_WIRED | reservation-settlement.ts; migration 016 | Explicit approval path not in production execution chain |
| Audit and alerts | PARTIALLY_IMPLEMENTED | audit-chain.ts; observability-store.ts; candidate-projection-observability.ts | Candidate evidence exists; end-to-end live events absent |
| Realtime order delivery | PARTIALLY_IMPLEMENTED | index_with_d1.ts /ws/updates; src/hooks/useBackendWebSocket.ts; provider user-stream.ts | Current socket only status and ping, no durable live event replay |
| Circuit breakers | PARTIALLY_IMPLEMENTED | index.ts circuit_breaker_state; Guardian and provider timeout handling | Must bind to live provider authority |
| Certification / release gates | IMPLEMENTED_NOT_WIRED | live/certification.ts; release-gate.ts; operator-read-model.ts; migrations 013,028,029 | External/provider/deployment evidence absent |
| BTCC current provider mutation contract | EXTERNAL_BLOCKER | docs/BTCC_PROVIDER_CONTRACT_STATUS.md; historical backend/adapters/exchanges/btcc.py | Current authoritative restoration, endpoints and signing contract required |
| BTCC legacy endpoint adapters | HISTORICAL_REFERENCE | backend/adapters/exchanges/btcc.py and branch blob index | Never promote guessed historical endpoints |
| Coinbase/public data | PRODUCTION_WIRED | index.ts public REST; fast-path/normalizers/coinbase.ts | Public reads only; freshness still needs execution gate |
| Render execution | HISTORICAL_REFERENCE | backend services; feat/live-execution-readiness-gate | Must remain legacy; do not establish second authority |
| Native Cloudflare Queues | SUPERSEDED | live/queue-contracts.ts; queue-contracts.ts; coordinator SQLite outbox | No demonstrated need to add native Queue |
| Atomic request admission | IMPLEMENTED_NOT_WIRED | security/worker-request-admission-boundary @99c8e85; closed #176 | Recover additive paper migration and outer entrypoint |
| Vercel frontend | PRODUCTION_WIRED | vercel.json; production deployment dpl_7wbTHjCMgHSX6qRoUUQNrVHvrNF3 | READY at baseline SHA; smoke not yet available |
| D1 / KV / R2 production | EXTERNAL_BLOCKER | main Cloudflare checks failed; wrangler production DB ID absent; latest KV/R2 recheck history | Account resource/permission evidence needed; candidate IDs placeholders |
| Withdrawals | PARTIALLY_IMPLEMENTED | index_withdrawals_candidate.ts; withdrawal-policy.ts; transfer lifecycle | Independent activation unavailable, remains disabled |
| Operator identity gateway | IMPLEMENTED_NOT_WIRED | open #167 @bd015a7; src/server on branch | Source-only trusted session/RBAC/aggregation; runtime bindings absent |

## Search evidence for new work

No system is classified TRULY_MISSING merely because main does not wire it. Existing recovery composition and admission are reused. Exact-identity validation, bounded scheduling composition and truthful socket evidence are integration/correctness gaps in existing systems.

Cross-branch `git grep` results: runAttestedBitgetRecoveryCycle: 12 branch/path hits, only module/test; scanLiveOrdersForRecovery: 32 hits, scanner/operator read/tests; planRecoveryLookup: 16 hits, module/tests; ExchangeAccountCoordinator: 405 hits, same base/observed implementations; request_admission_counters: 4 hits on recovered security branch. No scheduled recovery caller was found. PR patches were also indexed for these paths.

## All branch heads

| Branch | SHA | Ahead / behind main |
|---|---|---|
| agent/backend-readiness-hardening | `eca1fd4ee15d4d7996a83ee22a1d078debf9e746` | 0 / 779 |
| agent/complete-paper-app-update | `c25f27049fe4eb8f2d59fef56b1214b660672efc` | 0 / 769 |
| agent/production-lock-finalization | `3d3fcb9faa37459b66b58408af4b1fcedb9f60c1` | 0 / 1121 |
| agent/render-cors-env-alias | `dd3f92f040b02f7aeda2960d75ec20e45b1adcfe` | 0 / 1088 |
| agent/render-management-tooling | `2d3b6711da8cff2ce7d5179997ccff20259ba5fa` | 3 / 1091 |
| agent/self-hosted-release-lane | `084fb2a25c2674c2cb7cea2f2d4402d375117075` | 0 / 795 |
| app-loading-issue | `1a7565a8d5af26c6f3cd53eb903d6a82c9a95bd5` | 0 / 1053 |
| base44/setup-1375e37d | `35581e2d25d67ae05f66572ccdfe01ffcb95c015` | 1 / 0 |
| bolt-audit-optimization-17911972495626518816 | `1b8e73bd496aaded6ed6a740f6982b0706eaef47` | 4 / 665 |
| bolt-audit-store-opt-15749945857855272913 | `97a2d754bf288e891c50714ba0451b8a0d72a537` | 1 / 190 |
| bolt-batch-prices-2675182912948155950 | `64ab982fb097b3d145785ea325688a43b614f6b6` | 0 / 1077 |
| bolt-batch-ticker-optimization-7309914017136832995 | `8976d60e6e50552b3c7e9a28eff2846ce607484d` | 1 / 999 |
| bolt-binance-ticker-optimization-8757097558955256574 | `b1bacd25b379a06f42938fb69c173474f65b4a71` | 0 / 1042 |
| bolt-cache-adapters-6994863676897438234 | `a4c6065499631d23568e864e60b28d9e05b02c36` | 0 / 1057 |
| bolt-circular-buffer-events-17497083322067632410 | `a0690fe1de4ec8ff87a06303731b1318ca072d25` | 1 / 190 |
| bolt-ema-optimization-4927816203956169189 | `e0148856e17086a485d7b4ec3f90d96ca73c4ff4` | 1 / 668 |
| bolt-indicator-iterator-opt-13072516153815968149 | `6b664877193c4d8c59f1770bfddce4bce3f4274e` | 1 / 665 |
| bolt-indicator-iterator-opt-15586107130311616114 | `d9125d0e28bc1da9cf6c042e458d011670eeae22` | 1 / 665 |
| bolt-indicator-iterator-opt-4386623790501476658 | `c7fc5534b05ac2aab3a78103b369d10d60f10005` | 1 / 668 |
| bolt-indicator-iterator-opt-9738511337387858026 | `43cb617479d50cc1f0c1f4013a0674d86bb8ea17` | 4 / 671 |
| bolt-indicator-iterator-opt-v2-16452904116641564565 | `aa714d1a03ac6d2b752e15b53ed0d62524703f8a` | 1 / 665 |
| bolt-indicator-optimization-11720696522747987775 | `f308fb6a80d5bb221f784ddc4ad6657629914afc` | 4 / 792 |
| bolt-indicator-optimization-8919538155458412807 | `f1413aaca92fd52a42d395c32c264b08384574fb` | 4 / 933 |
| bolt-indicator-optimization-v3-1808133417938779691 | `d8e3387cbe71e36cc9416686827b23de9350c4a3` | 1 / 665 |
| bolt-indicator-optimizations-66391648732162555 | `a4d7b4cab33103c051586a67ff926691695b21c3` | 4 / 767 |
| bolt-indicator-optimizations-8605729134430923937 | `f51c68197029ee510cf45266a38b71e42e3f8faa` | 4 / 779 |
| bolt-iterator-optimization-8673496857257341953 | `3a85adc23419859be7b206d107c66e8f25934332` | 1 / 668 |
| bolt-macd-optimization-6677707619901005175 | `1163f0c59d20bc5df0384d09c63adef0997a1a1b` | 0 / 914 |
| bolt-opt-audit-retrieval-12132781602720111974 | `163b4587674264acf9ef12e2684afe1bf47096bb` | 1 / 665 |
| bolt-optimize-audit-log-retrieval-10473788071310746927 | `dbf6935c3432233a2d49da422b715e635b493121` | 1 / 665 |
| bolt-optimize-audit-logging-15766804942368592862 | `76e9f59114de1d528d6d5981b938b391ba93ae98` | 1 / 1061 |
| bolt-optimize-audit-store-retrieval-2424416717314883623 | `a1e27e227819a85b16b9ac930fab69cb45e7487d` | 4 / 665 |
| bolt-optimize-bollinger-bands-57552996397446536 | `d8c7a320c970432fd8186343d1e84388cbbe4fc6` | 0 / 956 |
| bolt-optimize-broadcast-latency-6272045727178941607 | `19dc41640984a8b56c67ec105d607de57fd4836a` | 6 / 851 |
| bolt-optimize-ema-formula-1304466280584211095 | `b342491c29d98fa0c86f4d835f959988d4ee6ae0` | 4 / 800 |
| bolt-optimize-event-log-init-2295791387852935263 | `04130179ab7ba4af5df085570623c65375fac53f` | 0 / 1075 |
| bolt-optimize-indicator-loops-1486331748796546846 | `d89b8dcead5873ff4d8f120cfe46f8704e429254` | 1 / 681 |
| bolt-optimize-indicators-2686335508369275735 | `d3007df7f2236467830343952783fcc81c368282` | 2 / 682 |
| bolt-optimize-indicators-8094526268140326211 | `6328d709375cd7310d2a450fdf4b075bb85c4ef8` | 1 / 665 |
| bolt-optimize-indicators-algebraic-4722759719122625666 | `7e986753256190b27059999941abc881084cac33` | 5 / 792 |
| bolt-optimize-indicators-islice-5270407516248412740 | `e81be2921c39341f3a4cda9cba63971684250fd6` | 4 / 671 |
| bolt-optimize-indicators-iterators-100887161300008048 | `8cc67fc4d86d4821d1f24d05fd6717f1ea526d43` | 1 / 665 |
| bolt-optimize-indicators-iterators-2330323796383979645 | `a4d329b0e4c848f1a0b9e44b58406bf05ab7c6b9` | 4 / 665 |
| bolt-optimize-indicators-iterators-8770752317851123432 | `3514c201076bcd19b51b1667116c36d1264481ad` | 4 / 665 |
| bolt-optimize-indicators-itertools-zip-2648863117659204077 | `155684fd074d4fd7d4d69533f489fe0082892f96` | 1 / 668 |
| bolt-optimize-indicators-last-value-16316071258421773175 | `f7e82772736f3a0cb6c0b0d95aa1a02b170f4c5d` | 0 / 925 |
| bolt-optimize-indicators-series-16071185011448695752 | `669bd1a6f38d7eacca904b24a4f732ed3c8f14fb` | 0 / 688 |
| bolt-optimize-indicators-v2-10983235612647892401 | `3f5efdbf6c9c99bf32d2aece84e34a33232b423e` | 0 / 831 |
| bolt-optimize-last-ema-14786053178439188541 | `5afe2fdf66864be42a55e3c91f829acbbf3ea31f` | 4 / 665 |
| bolt-optimize-last-ema-iterators-103957469953535006 | `e06f978cb1d219a6ddf0c76e7f4dbe6215217f73` | 1 / 671 |
| bolt-optimize-last-indicators-16227235244882975962 | `a381ce6c5d9ea776da3d749b4a2d073c475b12bd` | 4 / 665 |
| bolt-optimize-macd-series-10076581941441448389 | `40c66e3680b56a3fb3e00091bcd100a8c150a9de` | 0 / 807 |
| bolt-optimize-market-data-polling-8544674367330592691 | `21b1980efe9da4eb36dcbd573c2dc1b5c9e982ae` | 0 / 980 |
| bolt-optimize-rsi-atr-indicators-7517031746095711663 | `6dd5561cc5699f794f6b198676b5023c2e7276f9` | 0 / 857 |
| bolt-optimize-rsi-atr-series-8915028085931515217 | `544b877cb44dae356d86daa2fc521890af1aa0c4` | 2 / 820 |
| bolt-optimized-audit-store-18358418438687342281 | `0bb29a3e341153d9d4eb81a03751b9df610991e2` | 0 / 1108 |
| bolt-optimized-last-value-indicators-with-iterators-2113144490521548102 | `585976beb182e51f08c3c78cebef85cc63b0a25b` | 2 / 665 |
| bolt-rate-limit-deque-18097789991470156289 | `ccd27825ed22715490dc627cd846ac719df5ae4a` | 1 / 190 |
| bolt-rate-limit-perf-11988617636227538934 | `1d1f3b4151e61759b39df30b204544a3b75e6074` | 1 / 665 |
| bolt-rate-limiter-optimization-5427865807004463981 | `185de2067c4cbeadc16b1a3993f4a4c980768361` | 1 / 190 |
| bolt-replay-optimization-16547643713004270882 | `36557221c5689a43ce9fe87173cc3abdaa98d569` | 0 / 844 |
| bolt-rsi-optimization-2407535806193654676 | `8b3eb30422e6124ec92bc721a40f22768fe6036b` | 1 / 682 |
| bolt-websocket-broadcast-optimization-11678029879448057339 | `b2b469a5b199fdfb55c9f91d220cc5116a1572e4` | 6 / 818 |
| bolt/audit-store-optimization-14543499044069194154 | `e942b8746f5ddd7f10ec28938c6cfe28c6b000bc` | 1 / 665 |
| bolt/indicator-iterator-opt-3427590533055049196 | `39825e6a9d2bb8fbf143ad8bd28223a80d4ae081` | 1 / 665 |
| bolt/optimize-event-log-init-11617335956356247449 | `edc642adb31fddbfc6667555bdf331421cc8bc72` | 0 / 1064 |
| bolt/rate-limit-deque-decouple-10886927812095006901 | `03a652b8f739cfe79f41489c911214db9406b6be` | 1 / 190 |
| bolt/replayer-on-optimization-12630189856106136857 | `68fe825fe9e446964966f3a98ceb0ea9454f24e7` | 6 / 830 |
| build/pin-node-22-runtime | `ae5df8bd2793561903b421260ddf8d5e957a190c` | 1 / 190 |
| cert/worker-runtime-c9041d7 | `c0eabec88a3ab0f48f39d325d46637c288847fc6` | 2 / 175 |
| chatgpt/access-diagnostic-test | `335a545073c33c68b133ee255f4bb7cc291dbc94` | 2 / 41 |
| chatgpt/attestation-management | `04dd441a37c25a63e50d81025e9f78e449349cb4` | 0 / 61 |
| chatgpt/configure-production-auth | `c1c3bc4e2a91ab947510a00e9f2aed941554c0cc` | 0 / 73 |
| chatgpt/dashboard-access-hotfix | `4ea5889ad597f939b83d77d7aa090b9383c927e2` | 1 / 47 |
| chatgpt/dashboard-ui-refresh | `5324e97a1db774554ca22edf4297ec59cfbf66a5` | 0 / 129 |
| chatgpt/final-usage-management | `dba5068ba5d0708747ef65bf5d65bb11522a8bb4` | 0 / 81 |
| chatgpt/finalize-paper-intent-realtime | `01759af00b7de28636403e3941f2ea2d0032f9bf` | 4 / 31 |
| chatgpt/fix-login-backend-fallback | `57213e64056cee887ed30a734116ea06279a2432` | 0 / 57 |
| chatgpt/fix-paper-intent-realtime | `43cc28589a9c96b080247fae869d90132aaf2905` | 6 / 31 |
| chatgpt/harden-auth-gateway | `7709d1f184cdfb77a67a24381d4731800026cf21` | 9 / 49 |
| chatgpt/operator-control-audit-events | `6350d3b5ba08ffb88bab4526e197c4900eb8465c` | 0 / 1124 |
| chatgpt/production-acceptance-probes | `ce4b99a584e640229ee823a441a4db7e13511441` | 0 / 70 |
| chatgpt/stabilize-trust-probe-rate-limit | `47aa33a9038e12b75c0162006f5269755dfa4421` | 1 / 21 |
| chatgpt/status-management-readiness | `b60a5375f8cd2c3767efff6908de7cd1bec3241f` | 0 / 69 |
| chatgpt/trust-reliability-hardening | `e44c5306b781f1d8eb9e09ec5176d6bb7dad10bf` | 2 / 30 |
| chore/cryptoops-gpt-action-urls | `976abd4806e1481f7d43dd4b7f66199e7e974fc4` | 22 / 665 |
| ci/codeql-github-hosted-coverage | `18c3f2f5476567024a18692c9c6b55cf5b372982` | 0 / 190 |
| cloudflare-artifact-ed03f7f | `df851f16f72d68bde94d3f820b398fb9506f6d72` | 1 / 184 |
| cloudflare-paper-release-ed03f7f | `ed03f7f1be997d93058606ccfafa5be330cb9700` | 0 / 184 |
| codex/analyze-and-fix-frontend-and-backend-deployment-issues | `10bc4bccae0eb2bd11bd1ae7600726a64a65d572` | 0 / 1104 |
| codex/analyze-and-fix-frontend-and-backend-deployment-issues-miupua | `02017a6d3d8c8ac378a0b05ab8c412bffb5f39c0` | 0 / 1104 |
| codex/check-manus-task-status-for-backend | `50fd0becadbe51ebc62b834da4f7414f9c453c4e` | 0 / 179 |
| codex/circleci-paper-worker-release-20260815 | `82dede6adbce0a063078647c1226e263247f62ba` | 2 / 188 |
| codex/exact-main-worker-release-trigger-20260815 | `487cb6a54853dd6c9cc5a64363399cd5d0136bd0` | 2 / 187 |
| codex/execute-deployment-instructions | `720f623755b06fa19c9f7b97c418cb3f6d27dc4f` | 0 / 849 |
| codex/finalize-paper-production-20260825 | `754d1135dbabb5d8348cea9ae0503bc4cdacb995` | 15 / 185 |
| codex/finalize-production-readiness-20260815 | `65cc25e9029bc2e594500632c148d28ddd00eaea` | 8 / 190 |
| codex/finalize-release-reconciliation-20260904 | `f00e6793b2fea59942aac62b927c100573d8c1b6` | 3 / 184 |
| codex/fix-circleci-worker-fast-path-job | `fce9ccbbee6d3e35cf02ff51d4f840e014480f3e` | 52 / 671 |
| codex/market-review-forex-scope | `e97c0a61b41322e90166ecc9063f3e768d726bfd` | 4 / 2 |
| codex/native-cloudflare-worker-builds-20260815 | `131ae51318cc6365a51a9b4b281fcb79f59c0297` | 3 / 186 |
| codex/refresh-audited-dependencies-20260815 | `bbc2de92da0e8797a266fa0f272ef883645c1ef9` | 5 / 189 |
| copilot/fix-production-readiness | `809e23ae042da673b0feb908c563053a74ad3b73` | 11 / 665 |
| crypto-signal-bot | `5a6ae197dbbdfa7dee4c397d2a9547e8368690a3` | 2 / 800 |
| cryptoops/normalize-index-with-d1-20260618 | `8ae82ea6a0159aebbd495b279c0595c3ecb93cde` | 4 / 687 |
| dependabot/npm_and_yarn/npm_and_yarn-5488e93405 | `20f97822b1573e6aa3df7dd0189891f1f1b574cf` | 1 / 1 |
| devin/1780014187-integration-remediation | `8080600b81d7abf40f6225a2b4d6e03b813fdc4f` | 0 / 1038 |
| devin/1780046930-hardening-layers | `f39d8229ab15f53f7e7968d03d77015045011e3d` | 0 / 1030 |
| devin/1780056015-fix-review-findings | `3d82952db61cd1f25bfa3feb0c1f634a6cb961db` | 0 / 1028 |
| devin/1780082316-vercel-code-quality-fixes | `29c9f3204c2d454b39c3719191bcdd82e13fecce` | 0 / 1028 |
| devin/1780087360-system-stabilization | `263f7d2817e8b549cbc28741492c5aee602f2439` | 0 / 1023 |
| devin/1780104435-fix-market-data-source | `13969a0f1f6d3c195363ffac7fd9bdeb5c3f4b99` | 0 / 1016 |
| devin/1780106490-phase8-ci-traces-polish | `caf5cde1655b872c54c175d3aec0cccac600e679` | 0 / 1005 |
| docs/btcc-provider-contract-status | `6301c2eccef9a8eb0b72bf398a113422930300ac` | 1 / 13 |
| docs/fast-path-phase-1-2-status | `4a2f8db4592743876f99b432876ff9a0d4f62b08` | 1 / 669 |
| feat/advanced-trading-architecture | `68103906fe15fa1fb5ae17cd6e6dac43719ad5af` | 1 / 671 |
| feat/agent-autonomy | `9d4e3d150fa41957ca2576244ddd5e670acd6646` | 2 / 695 |
| feat/agent-build-command-trigger | `255793e862f83fb6c39b9685b53fbe9a0d5aa76a` | 43 / 190 |
| feat/agent-context-route | `a9881cbc5a654609c29125fab07647be6dbd0939` | 5 / 668 |
| feat/agent-improvements | `941a931c7ef9d5083ed69958a2d3780d9b245be7` | 9 / 720 |
| feat/architecture-command-center | `b54c8e38dd7332f69e225add97fea69206a0ede6` | 0 / 671 |
| feat/automated-monitoring | `c58bfe98a1be524cd3af316a2eed4d7359021690` | 4 / 694 |
| feat/complete-app-v2 | `1e028d430aa763dec411a468ddcadb3ff4fa5220` | 0 / 682 |
| feat/complete-app-v2-20260619 | `1e028d430aa763dec411a468ddcadb3ff4fa5220` | 0 / 682 |
| feat/live-execution-readiness-gate | `628e11bdbd3926dfe53098d825c6ad79d64ae9ab` | 17 / 668 |
| feat/operator-identity-gateway-foundation | `bd015a797afe943f9c1f3f220236aa8b0e1eb097` | 108 / 190 |
| feat/regulated-live-foundation | `d104ea6c7db4e86cd66178b3a0152bdd15712dcd` | 0 / 191 |
| feat/safe-fast-path-feed-integrity | `e966072e9f342f68a6f70c023e121215d3f77649` | 53 / 671 |
| feat/safe-fast-path-feed-integrity-checkpoint | `352f2713c5f515e8e33aa343704643556c57c4ed` | 48 / 671 |
| feat/safe-fast-path-feed-integrity-clean | `fea308220c7e78aa3023299932319bb5552993de` | 23 / 670 |
| feat/safe-fast-path-feed-integrity-pr | `352f2713c5f515e8e33aa343704643556c57c4ed` | 48 / 671 |
| feat/safe-fast-path-feed-integrity-review | `352f2713c5f515e8e33aa343704643556c57c4ed` | 48 / 671 |
| feat/safe-fast-path-phase12-clean | `094d908520bb22674db65dd83a5e8f0e86ca3cd9` | 1 / 670 |
| feat/safe-fast-path-standard | `065b4eafb8356a14a35d79a82c26313b0f0cba4e` | 27 / 671 |
| feat/safe-fast-path-target-ui | `306640686306307595cf6c92d58f8318ea4b4c7b` | 4 / 184 |
| feat/switchere-card-security-preflight | `029285ffe3dfde3566ef4377a7eff964847d22a7` | 10 / 190 |
| feat/target-alpha-architecture | `2734da409ee56e694b937f0cb54493d4550fc052` | 3 / 671 |
| feat/target-architecture-showcase | `201826c918749cd6e80a111ca546c70b2650f210` | 7 / 671 |
| fix-healthz-cors-and-auth-warning-13958966391783651552 | `d730943c98c8e17cb6d23cb42be867eef1df2021` | 2 / 1072 |
| fix-main-1579431ffaaa | `9130c2cfacf29d2c88840725036341f8079a3ad5` | 1 / 0 |
| fix-worker-lint-and-typecheck-18138385062103633145 | `4a8cb2f7ad41468caa61cabe60781cee4ce3492b` | 1 / 792 |
| fix/atomic-idempotency | `22afc817ded61105a544c03f687f03e565a68ecf` | 1 / 20 |
| fix/backend-build-render-12612945036522493664 | `e4fe33680962cbf400412f8a99f0a11e7d667f27` | 0 / 1100 |
| fix/ci-portability-node22-20260731 | `2da883f89a47f60746ab237649d4bfc6039aa948` | 3 / 190 |
| fix/cloudflare-d1-autoprovision | `1ec9fdd9baa7e3abffd5e986c9fa0db2b1826cef` | 1 / 177 |
| fix/cloudflare-kv-autoprovision | `da712c2615642b4789a5d5abfec30b67aa1ff96a` | 1 / 178 |
| fix/cloudflare-production-readiness | `faa037af0841c2c3ec38bb4559ece1d1004de43c` | 8 / 665 |
| fix/dashboard-final-checkout | `6d8fc537ed3d9c35f7b4d55f7e944970f624b3e3` | 0 / 949 |
| fix/dashboard-runtime-contract | `f34d3ecb8ed69f598cb4dc2772c81d808e0418b5` | 0 / 136 |
| fix/dashboard-worker-parity | `3928bff6105cc7bad8cd30d756688fc0b1a6aba1` | 8 / 809 |
| fix/failure-path-hardening | `acaf7ce8fddb8a1503302911cf35fc2994e4e4c3` | 1 / 18 |
| fix/paper-idempotency-risk-decision | `144b1180bd259318b5c366ef0cdd01ba2be9ebd8` | 0 / 26 |
| fix/rate-limit-fail-closed | `1698eee7a72e8b60fb4c3df7464f0728a7aa16e3` | 0 / 24 |
| fix/trusted-proxy-rate-limit-hardening | `2a3b05beb9b8d3c69ca1de09242ebcd1486e1fcc` | 3 / 190 |
| integration/bitget-recovery-cycle | `5def89af94b4922b9e9be29c90bc284e47da3794` | 2 / 10 |
| integration/bitget-recovery-reconciliation | `2073c6d91ea9e12d2ab90b04d59cad5d2ae90174` | 5 / 11 |
| integration/live-candidate-gate-chain | `a496316902da5eeb7e7b1ab34e4f4e257e69e118` | 2 / 16 |
| integration/live-recovery-scan | `f29ed85322dbdc56599428d53e42591267519152` | 3 / 15 |
| integration/recovery-operator-read | `0c74d226ed15e603f849da6847faaae4da5acf52` | 6 / 14 |
| integration/recovery-reconciliation-plan | `610fb6ba670986fddd4beae7bdf5456db9230ece` | 2 / 12 |
| jules-11520023176183307086-73d7e8e3 | `041f74cce61998519bd00fa42e3fc9cfa305e40d` | 1 / 665 |
| jules-12785642413429642673-e8a8f6bd | `8bcb003b5ad8761dfef52bf5d5ea72ba753ad6f9` | 1 / 190 |
| jules-15278362290609500273-28eee5d4 | `24a1fe7bea28b795f49df677dc1b1a51d8c7ea23` | 1 / 190 |
| jules-16351703734614060482-07e6d592 | `8fcbf3f31c9af62e5e1b9a3df2480ad266ef6660` | 1 / 190 |
| jules-17217988012814261811-782348c8 | `62a8ae1e22c218eab3283127a7c4dc7840b7c5cd` | 1 / 190 |
| jules-17337814390640664318-ab6c8feb | `cfb5551cca9babe2043e14dc7824ca66385ee101` | 1 / 190 |
| jules-658431371961418545-c1e6cf1e | `eacb2516a2fb920e77644abdb46e9fc9f9385850` | 1 / 190 |
| jules-7138816470093302552-73c325b9 | `66073535582d3eaada798169c4e9d4675b5ca751` | 2 / 190 |
| jules-8023618964106673969-62e45b1b | `3617256e127decf1b65c1d22708f168270a4d99a` | 1 / 190 |
| jules-9982654609307393982-bfa0a059 | `dcd3b2a9d69aed5785d0b76d8ddeeaaf4eb7af69` | 1 / 190 |
| main | `70ec4e396f64a69cac46eab8e260ac5a6e6a50c7` | 0 / 0 |
| ops/runtime-certification-c9041d7 | `ebf5ce8a30e6372ce68308c3cd79416dcb9c702c` | 5 / 175 |
| ops/verify-new-cloudflare-backend | `9d5c908e31f724361cf0ca544d8c179b392fd032` | 0 / 174 |
| perf/audit-trace-retrieval-current-main | `da93e75f41281f490063cfd936f85a0068a39ffa` | 5 / 190 |
| perf/indicator-iterators-current-main | `cc2b32c68e75bef3485ed9ec190f8258e7a26703` | 2 / 190 |
| release/paper-worker-2c9a890 | `2c9a890a8dad235edf1720b727e11ca75cd38ae4` | 0 / 185 |
| release/paper-worker-3ed2dfe | `3ed2dfe6fbb00b70531ffcbc87246b313074d9d8` | 0 / 186 |
| release/paper-worker-589f135 | `589f13546ab13b366b29d59c79582fa438befe75` | 0 / 72 |
| release/paper-worker-c9041d7 | `c9041d7f849fbbe141f52d9d9d3ec321fd668767` | 0 / 175 |
| release/paper-worker-ce4b99a | `ce4b99a584e640229ee823a441a4db7e13511441` | 0 / 70 |
| release/paper-worker-e1b0cbd | `e1b0cbd5b46c31143797e2ddda90aa6bf99080cd` | 0 / 30 |
| release/paper-worker-ed03f7f | `ed03f7f1be997d93058606ccfafa5be330cb9700` | 0 / 184 |
| render-health-direct | `1990da90ea8a57bc601c2a50dc4c89b198282e0d` | 0 / 1085 |
| render-health-wrapper | `3e091d75f5c1c051a28b1db3acbd809f4fc61d2f` | 0 / 1082 |
| security/render-paper-fail-closed | `8137172c8388419bd072a694e9becdb23729a179` | 1 / 17 |
| security/worker-request-admission-boundary | `99c8e852f9f2f1dd1f8c9f7edd4798e5cd1e8d14` | 13 / 190 |
| tmp-safe-fast-path-lock-generation | `99c454f37e6bdcd6158e1396725caca0b99fe1f9` | 19 / 671 |
| tmp-safe-fast-path-lock-generation-2 | `89517803aaeb091b7e99fb303193707a5267519a` | 14 / 671 |
| tmp-safe-fast-path-lock-generation-final | `89517803aaeb091b7e99fb303193707a5267519a` | 14 / 671 |
| tmp-safe-fast-path-lock-generation-working | `89517803aaeb091b7e99fb303193707a5267519a` | 14 / 671 |
| tmp-safe-fast-path-lockgen-actual | `89517803aaeb091b7e99fb303193707a5267519a` | 14 / 671 |
| tmp-safe-fast-path-lockgen-source | `89517803aaeb091b7e99fb303193707a5267519a` | 14 / 671 |
| tmp-safe-fast-path-lockgen-workflow | `89517803aaeb091b7e99fb303193707a5267519a` | 14 / 671 |
| v0/admin-50ceacab | `5dd487b6aeb7e52b2b6d135ccffc4d288abd122b` | 0 / 1118 |
| v0/admin-526acb1d | `5dd487b6aeb7e52b2b6d135ccffc4d288abd122b` | 0 / 1118 |
| v0/admin-6a2a83c0 | `4809d4482c385413ee1778c87eafdb9fd33e37d8` | 0 / 1110 |
| v0/admin-93ae5c77 | `5dd487b6aeb7e52b2b6d135ccffc4d288abd122b` | 0 / 1118 |
| v0/alliancetrustrealtyearner-cell-0628ea59 | `85673eda9b21470ce501940443a2fbeeb1ad8e2a` | 0 / 1054 |
| vercel/install-vercel-speed-insights-b72jum | `0c8730afa8789cfab08d545a50197747fed11a74` | 0 / 59 |

## PR history

| PR | State | Branch | Purpose |
|---|---|---|
| #233 | OPEN | dependabot/npm_and_yarn/npm_and_yarn-5488e93405 | build(deps): bump the npm_and_yarn group across 2 directories with 2 updates |
| #232 | OPEN | codex/market-review-forex-scope | Add market review source workspace and FOREX.com integration scope |
| #231 | MERGED | fix/self-hosted-release-python | fix: self-hosted release on runner-provisioned Python (no setup-python) |
| #230 | MERGED | integration/bitget-recovery-cycle | feat: compose attested Bitget recovery cycle |
| #229 | CLOSED | integration/bitget-recovery-cycle | feat: compose attested Bitget recovery cycle |
| #228 | MERGED | integration/bitget-recovery-reconciliation | feat: reconcile Bitget recovery snapshots without mutation |
| #227 | MERGED | integration/recovery-reconciliation-plan | feat: bind restart recovery to GET-only reconciliation planning |
| #226 | MERGED | docs/btcc-provider-contract-status | docs: pin BTCC provider-contract blocker |
| #225 | MERGED | integration/recovery-operator-read | feat: expose account-scoped live recovery candidates |
| #224 | MERGED | integration/live-recovery-scan | feat: add read-only live restart recovery scan |
| #223 | MERGED | security/render-paper-fail-closed | security: make Render defaults fail closed |
| #222 | MERGED | integration/live-candidate-gate-chain | feat: compose live-candidate authorization and Guardian gates |
| #221 | MERGED | fix/failure-path-hardening | Harden failure paths: stale-price guard, fail-closed guardian, atomic rate limiter |
| #220 | MERGED | fix/atomic-idempotency | Make paper-order idempotency atomic via reserve-first claim |
| #219 | MERGED | chatgpt/stabilize-trust-probe-rate-limit | Stabilize trust probe under fail-closed mutation rate limiting |
| #218 | MERGED | dependabot/npm_and_yarn/npm_and_yarn-fee7c8719e | build(deps): bump the npm_and_yarn group across 2 directories with 3 updates |
| #217 | MERGED | fix/rate-limit-fail-closed | Rate limiter: fail closed for mutations; throttle /intent/paper |
| #216 | MERGED | fix/paper-idempotency-risk-decision | Fix paper order idempotency; wire authoritative risk decision to dashboard |
| #215 | MERGED | chatgpt/trust-reliability-hardening | Harden trust checks and Worker cold-start reliability |
| #214 | MERGED | dependabot/npm_and_yarn/worker/npm_and_yarn-41f14ddda9 | build(deps): bump hono from 4.13.2 to 4.13.5 in /worker in the npm_and_yarn group across 1 directory |
| #213 | MERGED | chatgpt/fix-paper-intent-realtime | Restore authenticated paper execution and realtime Worker status |
| #212 | CLOSED | chatgpt/finalize-paper-intent-realtime | Finalize authenticated paper intent and realtime Worker status |
| #211 | MERGED | chatgpt/dashboard-access-hotfix | Restore authenticated dashboard access |
| #210 | MERGED | chatgpt/harden-auth-gateway | Harden production authentication gateway |
| #209 | MERGED | vercel/install-vercel-speed-insights-b72jum | Install Vercel Speed Insights |
| #208 | MERGED | chatgpt/attestation-management | Chatgpt/attestation management |
| #207 | MERGED | chatgpt/status-management-readiness | fix(status): distinguish pending evidence and expose management readi… |
| #206 | MERGED | chatgpt/configure-production-auth | Configure production authentication identity |
| #205 | MERGED | chatgpt/dashboard-ui-refresh | Restore and refine trading terminal dashboard UI |
| #204 | MERGED | fix/dashboard-runtime-contract | Fix production dashboard Guardian contract |
| #203 | MERGED | chatgpt/final-usage-management | Finalize production usage management and deployment control plane |
| #202 | MERGED | ops/verify-new-cloudflare-backend | test: verify migrated Cloudflare Worker endpoint |
| #201 | MERGED | fix/cloudflare-d1-autoprovision | Remove stale D1 ID for new Cloudflare account |
| #200 | MERGED | fix/cloudflare-kv-autoprovision | Fix KV binding for new Cloudflare account |
| #199 | MERGED | codex/check-manus-task-status-for-backend | Gate Cloudflare Worker deploy before updating Vercel and sync public backend envs |
| #198 | MERGED | codex/finalize-release-reconciliation-20260904 | fix: restore current release CI portability |
| #197 | MERGED | codex/finalize-paper-production-20260825 | fix: finalize paper production security and release gates |
| #196 | MERGED | codex/native-cloudflare-worker-builds-20260815 | Add mobile-safe native Cloudflare Worker deployment |
| #195 | MERGED | codex/exact-main-worker-release-trigger-20260815 | Add exact-main manual Worker release trigger |
| #194 | MERGED | codex/circleci-paper-worker-release-20260815 | Add billing-independent paper Worker release lane |
| #193 | MERGED | codex/refresh-audited-dependencies-20260815 | Refresh audited frontend and Worker dependencies |
| #192 | CLOSED | dependabot/npm_and_yarn/npm_and_yarn-f10f3b1c26 | build(deps): bump the npm_and_yarn group across 2 directories with 8 updates |
| #191 | MERGED | codex/finalize-production-readiness-20260815 | Reconcile paper certification production release |
| #190 | OPEN | feat/agent-build-command-trigger | feat: add guarded agent build command trigger |
| #189 | CLOSED | bolt/rate-limit-deque-decouple-10886927812095006901 | ⚡ Bolt: Optimized in-memory rate limiter |
| #188 | OPEN | bolt-circular-buffer-events-17497083322067632410 | ⚡ Bolt: Circular ring buffer for event IDs deduplication window |
| #187 | CLOSED | jules-16351703734614060482-07e6d592 | ⚡ Bolt: Optimize event log SQLite connection and write-ahead logging |
| #186 | CLOSED | fix/ci-portability-node22-20260731 | ci: make manual CodeQL portable and pin Node 22 runtime |
| #185 | CLOSED | jules-12785642413429642673-e8a8f6bd | ⚡ Bolt: optimize Decimal-to-float conversion in Replayer |
| #184 | CLOSED | jules-17217988012814261811-782348c8 | ⚡ Bolt: optimize in-memory rate limiter fallback |
| #183 | CLOSED | jules-658431371961418545-c1e6cf1e | ⚡ Bolt: Optimize fallback rate limiter to eliminate O(N) cleanup and O(M) list copying |
| #182 | CLOSED | jules-17337814390640664318-ab6c8feb | ⚡ Bolt: circular buffer for event deduplication |
| #181 | OPEN | feat/switchere-card-security-preflight | feat: add Switchere card security gateway |
| #180 | CLOSED | bolt-audit-store-opt-15749945857855272913 | ⚡ Bolt: Optimize audit store log and trace search |
| #179 | CLOSED | jules-9982654609307393982-bfa0a059 | ⚡ Bolt: Optimize Fallback Rate Limiter with Deque & Throttled Cleanup |
| #178 | CLOSED | dependabot/npm_and_yarn/npm_and_yarn-0e581b12ca | build(deps): bump the npm_and_yarn group across 2 directories with 8 updates |
| #177 | CLOSED | bolt-rate-limit-deque-18097789991470156289 | ⚡ Bolt: optimize in-memory rate limiter with deque and periodic cleanup |
| #176 | CLOSED | security/worker-request-admission-boundary | security: add fail-closed Worker request admission boundary |
| #175 | CLOSED | build/pin-node-22-runtime | build: pin Node.js to the 22.x runtime line |
| #174 | CLOSED | fix/trusted-proxy-rate-limit-hardening | security: harden trusted proxy and rate limiting |
| #173 | CLOSED | jules-8023618964106673969-62e45b1b | ⚡ Bolt: optimize in-memory fallback rate limiter |
| #172 | CLOSED | jules-15278362290609500273-28eee5d4 | ⚡ Bolt: Optimize in-memory rate limiter using deque and gated global cleanup |
| #171 | CLOSED | bolt-rate-limiter-optimization-5427865807004463981 | ⚡ Bolt: Optimize fallback in-memory rate limiter |
| #170 | CLOSED | perf/indicator-iterators-current-main | perf: consolidate iterator-based indicator optimizations |
| #169 | CLOSED | perf/audit-trace-retrieval-current-main | perf: optimize audit trace retrieval on current main |
| #168 | CLOSED | jules-7138816470093302552-73c325b9 | ⚡ Bolt: optimize in-memory rate limiter latency with collections.deque |
| #167 | OPEN | feat/operator-identity-gateway-foundation | feat: add operator readiness gateway foundation |
| #166 | CLOSED | dependabot/npm_and_yarn/npm_and_yarn-e7968a24c7 | build(deps): bump the npm_and_yarn group across 2 directories with 5 updates |
| #165 | CLOSED | jules-11520023176183307086-73d7e8e3 | ⚡ Bolt: Optimize in-memory fallback rate limiter |
| #164 | CLOSED | bolt-rate-limit-perf-11988617636227538934 | ⚡ Bolt: in-memory rate limiter optimization |
| #163 | MERGED | feat/regulated-live-foundation | feat: build disabled BTCC/Bitget regulated trading foundations |
| #162 | CLOSED | bolt-optimize-audit-log-retrieval-10473788071310746927 | ⚡ Bolt: optimize audit log retrieval |
| #161 | CLOSED | bolt-optimize-indicators-iterators-100887161300008048 | ⚡ Bolt: Optimized technical indicators with iterator-based loops |
| #160 | CLOSED | bolt-optimize-audit-store-retrieval-2424416717314883623 | ⚡ Bolt: optimize audit store retrieval |
| #159 | CLOSED | bolt-optimize-indicators-iterators-2330323796383979645 | ⚡ Bolt: optimize technical indicator iterator loops |
| #158 | CLOSED | bolt/audit-store-optimization-14543499044069194154 | ⚡ Bolt: [audit store optimization] |
| #157 | CLOSED | bolt-optimize-last-ema-14786053178439188541 | ⚡ Bolt: Optimize last_ema with itertools.islice |
| #156 | CLOSED | bolt/indicator-iterator-opt-3427590533055049196 | ⚡ Bolt: optimize indicator hot loops with itertools.islice |
| #155 | CLOSED | bolt-optimized-last-value-indicators-with-iterators-2113144490521548102 | ⚡ Bolt: Optimized last-value indicators with iterators |
| #154 | CLOSED | bolt-indicator-iterator-opt-v2-16452904116641564565 | ⚡ Bolt: Optimized technical indicators with iterator-based loops |
| #153 | CLOSED | chore/cryptoops-gpt-action-urls | chore: publish CryptoOps read-only Action schemas at stable URLs |
| #151 | CLOSED | fix/cloudflare-production-readiness | fix: harden the canonical Cloudflare Worker production boundary |
| #150 | CLOSED | copilot/fix-production-readiness | fix: restore paper-only production boundary and fail-closed readiness |
| #149 | CLOSED | bolt-optimize-indicators-iterators-8770752317851123432 | ⚡ Bolt: optimize last-* indicators with iterators |
| #148 | CLOSED | bolt-optimize-indicators-8094526268140326211 | ⚡ Bolt: Optimize technical indicators with islice and zip |
| #147 | CLOSED | bolt-audit-optimization-17911972495626518816 | ⚡ Bolt: optimize audit trace discovery with backward iteration |
| #146 | CLOSED | bolt-optimize-last-indicators-16227235244882975962 | ⚡ Bolt: Optimize 'last' technical indicators with iterator-based loops |
| #145 | CLOSED | bolt-opt-audit-retrieval-12132781602720111974 | ⚡ Bolt: optimize audit trace retrieval |
| #144 | CLOSED | bolt-indicator-iterator-opt-15586107130311616114 | ⚡ Bolt: technical indicator iterator optimization |
| #143 | CLOSED | bolt-indicator-iterator-opt-13072516153815968149 | ⚡ Bolt: optimize technical indicator loops with itertools.islice |
| #142 | CLOSED | bolt-indicator-optimization-v3-1808133417938779691 | ⚡ Bolt: Optimize technical indicators with itertools and single-pass algorithms |
| #141 | MERGED | fix/agent-context-direct-checks | fix: compute agent context directly at Worker entrypoint |
| #140 | CLOSED | feat/agent-context-route | feat: add /agent/context aggregation route for CryptoOps GPT agent |
| #139 | CLOSED | bolt-optimize-indicators-itertools-zip-2648863117659204077 | ⚡ Bolt: optimize technical indicators with itertools and zip |
| #137 | CLOSED | feat/live-execution-readiness-gate | feat: add fail-closed live execution readiness boundary |
| #136 | CLOSED | bolt-iterator-optimization-8673496857257341953 | ⚡ Bolt: Optimized technical indicators with iterator-based loops |
| #135 | CLOSED | bolt-indicator-iterator-opt-4386623790501476658 | ⚡ Bolt: Technical Indicator Iterator Optimization |
| #134 | CLOSED | bolt-ema-optimization-4927816203956169189 | ⚡ Bolt: Optimize EMA calculations using itertools.islice |
| #133 | MERGED | docs/fast-path-phase-1-2-status | docs(fast-path): record Phase 1-2 shadow boundary |
| #132 | CLOSED | dependabot/npm_and_yarn/npm_and_yarn-bc034184c5 | chore(deps): bump the npm_and_yarn group across 2 directories with 5 updates |
| #131 | CLOSED | feat/safe-fast-path-feed-integrity-clean | [DUPLICATE - DO NOT MERGE] feat(worker): add feed-integrity shadow path and v2 status contracts |
| #130 | MERGED | feat/safe-fast-path-phase12-clean | feat(worker): add phase 1-2 status contracts |
| #129 | CLOSED | dependabot/npm_and_yarn/npm_and_yarn-d81ac9649c | chore(deps): bump the npm_and_yarn group across 2 directories with 5 updates |
| #128 | MERGED | codex/fix-circleci-worker-fast-path-job | fix(fast-path): isolate Worker Vitest config |
| #127 | CLOSED | bolt-indicator-iterator-opt-9738511337387858026 | ⚡ Bolt: Optimize technical indicators with iterator-based loops |
| #126 | CLOSED | bolt-optimize-last-ema-iterators-103957469953535006 | ⚡ Bolt: optimize last_ema with iterators |
| #125 | CLOSED | feat/safe-fast-path-feed-integrity | feat(worker): add feed-integrity shadow path and v2 status contracts |
| #123 | CLOSED | tmp-safe-fast-path-lock-generation | ci: generate frontend package lock artifact |
| #122 | MERGED | feat/safe-fast-path-standard | docs/frontend: establish safe fast-path architecture standard |
| #121 | CLOSED | feat/target-architecture-showcase | feat: publish target trading architecture and frontend showcase |
| #120 | CLOSED | bolt-optimize-indicators-islice-5270407516248412740 | ⚡ Bolt: Optimize indicators with itertools.islice |
| #119 | CLOSED | dependabot/npm_and_yarn/npm_and_yarn-d4f187a0a5 | chore(deps): bump the npm_and_yarn group across 2 directories with 5 updates |
| #118 | CLOSED | bolt-optimize-indicator-loops-1486331748796546846 | ⚡ Bolt: optimize indicator loops with iterators and conditional logic |
| #117 | CLOSED | dependabot/npm_and_yarn/npm_and_yarn-11dac27e14 | chore(deps): bump the npm_and_yarn group across 2 directories with 5 updates |
| #116 | CLOSED | bolt-optimize-indicators-2686335508369275735 | ⚡ Bolt: optimize hot paths in technical indicators |
| #115 | MERGED | bolt-rsi-optimization-2407535806193654676 | ⚡ Bolt: Optimize RSI calculation formula and loop logic |
| #114 | MERGED | bolt-optimize-indicators-series-16071185011448695752 | ⚡ Bolt: optimize indicator series functions |
| #113 | MERGED | feat/automated-monitoring | feat: automated monitoring workflow + PR CI trigger |
| #112 | MERGED | feat/agent-autonomy | feat: Tier 1+2 agent autonomy — Render action, CI trigger, KV memory, context snapshot, system prompt |
| #111 | MERGED | feat/agent-improvements | feat: 7 GPT capability upgrades (agent-improvements) |
| #109 | CLOSED | dependabot/npm_and_yarn/npm_and_yarn-ca9e651328 | chore(deps): bump the npm_and_yarn group across 1 directory with 3 updates |
| #108 | MERGED | bolt-indicator-optimizations-66391648732162555 | ⚡ Bolt: Technical Indicator Optimizations |
| #107 | MERGED | agent/complete-paper-app-update | Complete paper-mode app stabilization |
| #106 | CLOSED | bolt-indicator-optimizations-8605729134430923937 | Consolidate backend readiness and paper flow fixes |
| #104 | CLOSED | bolt-optimize-indicators-algebraic-4722759719122625666 | ⚡ Bolt: optimize technical indicators with simplified algebraic formulas |
| #103 | CLOSED | bolt-indicator-optimization-11720696522747987775 | ⚡ Bolt: Optimize technical indicators in backend/logic/indicators.py |
| #102 | CLOSED | fix-worker-lint-and-typecheck-18138385062103633145 | Fix lint and typecheck in worker/src/renderParity.ts |
| #101 | MERGED | agent/self-hosted-release-lane | Add self-hosted GitHub Actions release lane |
| #100 | CLOSED | bolt-optimize-ema-formula-1304466280584211095 | ⚡ Bolt: optimize EMA and MACD calculation formula |
| #99 | CLOSED | fix/dashboard-worker-parity | Fix/dashboard worker parity |
| #98 | CLOSED | crypto-signal-bot | Update documentation to resolve multiple issues |
| #97 | MERGED | bolt-optimize-macd-series-10076581941441448389 | ⚡ Bolt: optimize MACD series calculation |
| #96 | MERGED | bolt-optimize-rsi-atr-series-8915028085931515217 | ⚡ Bolt: optimize RSI and ATR series calculation |
| #95 | MERGED | codex/execute-deployment-instructions | Add Cloudflare Workers backend, D1 migrations, CI/CD workflow and deployment docs |
| #94 | MERGED | bolt-optimize-rsi-atr-indicators-7517031746095711663 | ⚡ Bolt: optimize last_rsi and last_atr indicators |
| #93 | MERGED | bolt-replay-optimization-16547643713004270882 | ⚡ Bolt: optimize Replayer and BacktestEngine to O(N) |
| #92 | MERGED | bolt-optimize-indicators-v2-10983235612647892401 | ⚡ Bolt: optimize last_rsi and last_atr indicators |
| #91 | CLOSED | bolt/replayer-on-optimization-12630189856106136857 | ⚡ Bolt: Optimize Replayer to O(N) complexity |
| #90 | CLOSED | bolt-optimize-broadcast-latency-6272045727178941607 | ⚡ Bolt: Optimize WebSocket broadcasting latency |
| #89 | CLOSED | bolt-websocket-broadcast-optimization-11678029879448057339 | ⚡ Bolt: Optimize WebSocket broadcasting with pre-serialization and concurrency |
| #88 | MERGED | dependabot/npm_and_yarn/npm_and_yarn-45e9ac6fd3 | chore(deps): bump react-router from 6.30.3 to 6.30.4 in the npm_and_yarn group across 1 directory |
| #87 | MERGED | bolt-macd-optimization-6677707619901005175 | ⚡ Bolt: optimize last_macd with single-pass iterative implementation |
| #86 | MERGED | bolt-optimize-indicators-last-value-16316071258421773175 | ⚡ Bolt: Optimize technical indicators for last-value performance |
| #85 | CLOSED | bolt-indicator-optimization-8919538155458412807 | ⚡ Bolt: Optimize technical indicators and signal engine evaluation |
| #84 | MERGED | bolt-optimize-bollinger-bands-57552996397446536 | ⚡ Bolt: Optimize Bollinger Bands to O(n) |
| #83 | MERGED | bolt-optimize-market-data-polling-8544674367330592691 | ⚡ Bolt: optimize market data polling with batch REST calls |
| #82 | MERGED | devin/1780106490-phase8-ci-traces-polish | Phase 8: CI expansion, decision traces, frontend polish, docs update |
| #81 | MERGED | devin/1780104435-fix-market-data-source | Enable live Binance market data in paper mode by default |
| #80 | MERGED | bolt-batch-ticker-optimization-7309914017136832995 | ⚡ Bolt: Batch Price Fetching Optimization |
| #79 | MERGED | devin/1780087360-system-stabilization | Full system stabilization: WebSocket server, resilient frontend, keepalive, DB modernization |
| #78 | MERGED | devin/1780082316-vercel-code-quality-fixes | fix: resolve all lint warnings and remove deprecated localStorage API key pattern |
| #77 | MERGED | devin/1780056015-fix-review-findings | Fix 3 review findings: ALLOW_MAINNET consistency, graceful mainnet gate, persist rejected orders |
| #76 | MERGED | devin/1780046930-hardening-layers | Add 5 hardening layers for real-time transaction readiness |
| #75 | MERGED | devin/1780014187-integration-remediation | Integration remediation: 7 phases — wire services, fix config, add tests, fix API contracts, risk engine, documentation |
| #74 | MERGED | bolt-binance-ticker-optimization-8757097558955256574 | ⚡ Bolt: optimize Binance ticker fetch |
| #73 | MERGED | app-loading-issue | Fix application redirect issues by configuring environment variables |
| #72 | MERGED | v0/alliancetrustrealtyearner-cell-0bf20fb9 | Fix authentication redirect loops and enable demo mode |
| #71 | MERGED | fix-backend-status | Enable demo mode and improve backend status resilience |
| #70 | MERGED | bolt-cache-adapters-6994863676897438234 | ⚡ Bolt: Cache exchange adapters in MarketDataService |
| #68 | MERGED | fix-healthz-cors-and-auth-warning-13958966391783651552 | Fix Healthz route, CORS credentials, and Auth Warning |
| #67 | MERGED | bolt-optimize-event-log-init-2295791387852935263 | ⚡ Bolt: optimize EventLogStore initialization and memoize instance |
| #66 | MERGED | bolt-batch-prices-2675182912948155950 | ⚡ Bolt: Batch crypto price fetches |
| #65 | MERGED | render-health-wrapper | Add Render ASGI health wrapper |
| #64 | MERGED | render-health-direct | Make backend health endpoints dependency-light |
| #63 | MERGED | agent/render-cors-env-alias | Harden hosted health routes for Render |
| #62 | MERGED | agent/render-cors-env-alias | Accept Render CORS_ALLOWED_ORIGINS env alias |
| #61 | MERGED | agent/render-management-tooling | Add Render agent management tooling |
| #60 | MERGED | bolt/optimize-event-log-init-11617335956356247449 | ⚡ Bolt: optimize EventLogStore initialization |
| #59 | MERGED | bolt-optimize-audit-logging-15766804942368592862 | ⚡ Bolt: optimize audit event logging and database initialization |
| #58 | MERGED | codex/analyze-and-fix-frontend-and-backend-deployment-issues-miupua | Add Render readiness endpoint and startup entrypoint; tighten CORS parsing and frontend env fallbacks |
| #57 | MERGED | bolt-optimized-audit-store-18358418438687342281 | ⚡ Bolt: Optimized audit store with in-memory caching |
| #56 | MERGED | fix/backend-build-render-12612945036522493664 | Fix/backend build render 12612945036522493664 |
| #55 | MERGED | codex/analyze-and-fix-frontend-and-backend-deployment-issues | Add /ready endpoint, startup auth logging, robust CORS parsing, render start script, and frontend env fallbacks |
| #54 | MERGED | bolt-optimized-audit-store-18358418438687342281 | ⚡ Bolt: Optimized audit store with in-memory caching |
| #53 | MERGED | fix/backend-build-render-12612945036522493664 | Fix backend build and deployment issues for Render |
| #52 | MERGED | dependabot/npm_and_yarn/npm_and_yarn-e5a46ec0e1 | build(deps): Bump ws from 8.18.3 to 8.20.1 in the npm_and_yarn group across 1 directory |
| #51 | MERGED | agent/production-lock-finalization | Finalize production lock gate |
| #50 | MERGED | website-deployment-fix | Fix Supabase environment variable compatibility and app metadata |
| #48 | MERGED | chatgpt/guardian-ops-dashboard-controls | Surface Guardian scoped controls in dashboard |
| #47 | MERGED | chatgpt/execution-scope-guardian-gate | Gate execution by Guardian strategy and venue scope |
| #46 | MERGED | chatgpt/portfolio-exposure-controls | Add portfolio exposure risk controls |
| #45 | MERGED | chatgpt/strategy-venue-kill-switches | Add strategy and venue kill switches |
| #44 | MERGED | chatgpt/guardian-reconciliation-drift | Add guardian reconciliation drift signal |
| #43 | MERGED | chatgpt/salvage-jules-trading-platform-review | Record Jules trading-platform salvage review |
| #42 | MERGED | chatgpt/salvage-risk-agent-runtime-controls | Record runtime-control branch salvage decision |
| #41 | MERGED | chatgpt/stabilize-production-runtime | Stabilize production runtime and CI baseline |
| #40 | MERGED | claude/complete-trading-backend-qRGZk | Claude/complete trading backend q rg zk |
| #39 | MERGED | chatgpt/public-integrations-waitlist | Add public integrations, waitlist, and command-center compatibility routes |
| #38 | MERGED | chatgpt/public-service-integrations | Add public integration provider registry |
| #37 | MERGED | chatgpt/add-vercel-cors-origin | Add Vercel production origin to backend CORS |
| #36 | MERGED | chatgpt/fix-auth-provider-order | Fix auth provider context mismatch |
| #35 | MERGED | chatgpt/render-config-fix | Fix Render Docker config copy |
| #34 | MERGED | chatgpt/render-fix | Fix Render backend startup |
| #33 | MERGED | chatgpt/render-docker-backend | Add Render Docker backend support |
| #32 | MERGED | chatgpt/no-circleci-deploy-path | Add deployment path without CircleCI |
| #31 | MERGED | chatgpt/fix-blank-runtime | Add frontend startup screens |
| #30 | MERGED | chatgpt/event-log-api | Add event log API router foundation |
| #29 | MERGED | chatgpt/event-audit-wire | Wire audit store to optional event log |
| #28 | MERGED | chatgpt/event-log-smoke | Add event log check script |
| #27 | MERGED | chatgpt/db-audit-core | Add lightweight event log storage foundation |
| #26 | MERGED | chatgpt/db-layer | Add persistence migration planning docs |
| #25 | MERGED | chatgpt/proxy-security-hardening | Harden nginx proxy security posture |
| #24 | MERGED | chatgpt/ops-security-frontend-hardening | Add ops security and frontend env hardening |
| #23 | MERGED | chatgpt/port-claude-trading-backend-models | Port Claude backend ORM model exports |
| #22 | MERGED | vercel/vercel-web-analytics-integrati-txrzcw | Add Vercel Web Analytics integration |
| #21 | MERGED | chatgpt/branch-salvage-production-hardening | Add branch salvage inventory workflow |
| #20 | MERGED | chatgpt/repo-audit-continuation | Continue repo audit stabilization work |
| #19 | CLOSED | jules-backend-setup-11315302861801406339 | Jules backend setup 11315302861801406339 |
| #18 | MERGED | dependabot/npm_and_yarn/npm_and_yarn-754666cf41 | build(deps-dev): Bump postcss from 8.5.6 to 8.5.10 in the npm_and_yarn group across 1 directory |
| #17 | MERGED | claude/complete-trading-backend-qRGZk | Claude/complete trading backend q rg zk |
| #16 | MERGED | codex/task-title | Update CircleCI Node image to 22.12.0 and use `npm ci` |
| #15 | MERGED | dependabot/npm_and_yarn/npm_and_yarn-c4bc6a0a9e | build(deps-dev): Bump vite from 7.3.1 to 7.3.2 in the npm_and_yarn group across 1 directory |
| #14 | MERGED | dependabot/npm_and_yarn/npm_and_yarn-221312df6a | build(deps): Bump the npm_and_yarn group across 1 directory with 4 updates |
| #13 | MERGED | feat/backend-market-state-health | feat: move market state and health ownership to backend |
| #12 | MERGED | agent/backend-price-hook | Route dashboard price hook to FastAPI backend |
| #11 | MERGED | agent/backend-truth-readme | Align repo docs to FastAPI backend in main |
| #10 | MERGED | agent/readme-refresh | Add project README draft aligned to external backend architecture |
| #9 | MERGED | dependabot/npm_and_yarn/npm_and_yarn-e5a595f223 | build(deps-dev): Bump flatted from 3.3.1 to 3.4.2 in the npm_and_yarn group across 1 directory |
| #8 | MERGED | agent/backend-control-center-v1 | Add Replit to GitHub backend handoff guide |
| #7 | MERGED | dependabot/npm_and_yarn/npm_and_yarn-b2936519f3 | build(deps): Bump rollup from 4.58.0 to 4.59.0 in the npm_and_yarn group across 1 directory |
| #6 | MERGED | dependabot/npm_and_yarn/npm_and_yarn-bb3626eb1a | build(deps-dev): Bump minimatch from 3.1.2 to 3.1.5 in the npm_and_yarn group across 1 directory |
| #5 | MERGED | dependabot/npm_and_yarn/npm_and_yarn-2530fd4bb7 | build(deps): Bump the npm_and_yarn group across 1 directory with 6 updates |
| #4 | MERGED | claude/complete-trading-backend-qRGZk | feat: Add paper trading backend, Docker setup, and test suite |
| #3 | MERGED | feat/build-trading-platform-14047153187029945517 | Build Trading Platform End-to-End |
| #2 | MERGED | jules-backend-setup-11315302861801406339 | Jules backend setup 11315302861801406339 |
| #1 | MERGED | jules-backend-setup-11315302861801406339 | Create backend application and add gitignore |
