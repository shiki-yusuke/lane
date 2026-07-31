# M0 設計レビュー（gpt-5.6-sol、2026-07-31）

判定: 条件付き No-Go（M1 着手前に以下を design.md に反映すること）

## 最重要 — M1 前に直す

### 課題1 裁定: estimate.json を唯一の本体に、intent.estimate コピー廃止
- intent には estimate_ref と採用した baseline_estimate_revision_id だけを置く
- estimate.json は revisions[] の追記型。各 revision に estimated_at / as_of_phase / repo_commit / impact-scan snapshot / estimator_version / 近傍と距離 / 母集団条件を固定
- lane calibrate は採用 revision を参照し、既存 prediction を変更しない（後知恵バイアス防止）
- generated_at 1個でなく estimated_at / measured_at / calibrated_at を分ける
- 数値は非負・finite、p50 <= p80、誤差計算対象の p50 > 0 を refine で保証

### calibration schema: 観測と予測評価に分離
- 観測 = predictors + actual。予測評価 = estimate_revision_id + predicted + error。salvaged legacy ledger は観測のみで k-NN に使える（predicted が無いため）
- record_id 追加（calibrate 再実行の冪等化）
- predictor_quality: observed | reconstructed | imputed、measurement_quality、eligible_for_knn
- actual の metric は欠測可能に（欠測を 0 で表さない）
- cost_usd → estimated_cost_usd に改名 + pricing_catalog_version / pricing_status / credits を記録
- relative_error_p50 に加え covered_by_p80 を残す

### predictor 設計の修正
- files_touched_estimate（impact-scan の候補 path 数）と files_touched_observed を分離（allowed_paths glob 数は「許可範囲の広さ」であり予測変更数ではない）
- spec_rule_count 未確定は null（0 と混同しない）
- novel_surface は true | false | unknown（knowledge DB が空だから novel、を避ける）
- ImpactScanSnapshotSchema を estimate.ts 内の再利用 schema として定義（scan_version / commit / 候補 paths/layers / 未確定事項 / digest）

### 課題6 裁定: Codex 残枠は「低信頼の計算値」と明示、単位不整合の候補は fit=unknown
- ResourceSnapshot { provider, value, unit, observed_at, expires_at, quality, source }
- estimate 側にも provider/agent 別の demand を持たせる
- Claude の % used から token p80 が「収まる」と判定しない（分母か検証済み変換が無ければ並列表示のみ）
- 表示例: `Codex ≈6,200cr（低信頼: 手入力上限−推定消費、請求残高ではない）`
- stale / unpriced / lower-bound / 未知モデルがあれば推薦文を止める
- codex 設定に period_end または reset rule/timezone を追加。usedPct と残り% を混同しない命名

### 課題7 裁定: self ack 許容だが digest 束縛 + 種別区別
- reviewer_kind: self | independent_agent | human、reviewer_id / acked_at / spec_sha256 / verification_sha256 / evidence_ref / note
- 内容変更時は ack 自動無効化
- low/medium は self 可、high は independent_agent/human 既定（自己 ack は理由付き監査 override のみ）

### spec_consensus gate の実装可能化
- GateContext に schema 検証済み artifacts.intent/critic/verification/specDigest を渡す（現設計は lane-state に無い state.verification を読んでいて動かない）
- gate event を before_pr_publish と明示、4_verify→5_done でも digest 再確認
- disposition を action + status: pending | resolved + rationale/evidence に分離、pending は block、accepted にも理由必須

### 課題3 裁定: 依存方向の固定 + 機械強制
- schemas→none、core→schemas、adapters→core/schemas、cli→core/adapters/schemas
- PHASE_ORDER と PhaseSchema は最下層 schemas へ（現設計は schemas↔core が循環）
- port interface は core/ports、実装のみ adapters
- CI: tsc -b + dependency-cruiser（または package graph test）必須
- 存在しない @lane/telemetry-agent-cost import を削除、canonical Fact schema は lane 側 contracts として定義
- estimate/calibrate/next/knowledge/consensus は CLI でなく core の application service に配置

### lane-state は「変更なし移植」不可
- phase_history.result に in_progress を追加（Python 参照実装 の schema/実装乖離バグを修正して移植）
- cost_ledger / usage_import_attempts / gate overrides / effective mode / mode resolution log / PR provenance を正式 schema 化
- Zod の unknown key strip で ledger を消さない（strict/passthrough と保存への使用を明示）
- schema version は version dispatcher + migration

## 重要 — M2/M3 前に直す

### 課題4 裁定: agent-cost は CLI subprocess 統合（TS 再実装しない）
- agent-cost に最小の `measure/report --session-id --format json` 契約を追加（protocol version / pricing catalog digest / data quality / priced・unpriced tokens / credits を出力に含める）
- lane は spawn/execFile の argv 配列で呼び、timeout / exit code / stderr / 行単位 Zod 検証
- phase history に session_ids[]（複数）を記録。差し戻し時は同一 phase の全 occurrence window を union（Python 参照実装 v0.7.2 の既知回帰点）

### 課題5 裁定: 宣言値を保存し gate 毎に実効値を再計算
- intent は declared_risk を保持（上書きしない）。lane-state に effective_risk / 適用 rule IDs / profile digest / evaluated_at を監査記録
- gate 毎に max(declared, previous_effective, current_effective)。暗黙 downgrade 禁止
- risk_auto_upgrade は {id, when:{layers,paths,...}, upgrade_to, reason} の rule 配列に

### 課題2 裁定: Gower 距離相当の混合型距離（正規化 Euclidean + one-hot は不採用）
- 数値は log1p + profile 固定 cap、risk は順序尺度、boolean は一致/不一致、欠測次元は距離分母から除外
- 母集団 <8 は reference table。>=8 は最大7近傍、利用可能近傍 <5 なら fallback
- v1 は固定 weight + 非加重分位点。leave-one-out の p50 誤差と p80 coverage を表示、30件未満は常に experimental
- similar_intent_ids に加え distance と各近傍の測定品質を保存

### 課題8 裁定: 閾値 + top-N 併用
- 初期値 score >= 0.70 かつ全体 top3、各 lens 最大2件
- prefix は path segment 境界一致（startsWith で src/foo と src/foobar を一致させない）
- taxonomy bonus 単独では注入しない。閾値の自動調整は query/citation 実績20回まで凍結
- knowledge_refs は {record_id, score, matched_by, scoring_version}

### knowledge schema 追加要件
- repo_id/profile_id または明示的 global scope（~/.lane 全体での相対 path 衝突対策）
- source_ref / confidence / status: active|superseded / supersedes / applicability
- finding は taxonomy/evidence/resolution 必須の discriminated union、decision は context/rationale 必須
- paths 空の record は scope=global 明示が無ければ拒否
- JSONL は record_id 重複排除 + file lock（または 1-record-1-file）

### critic schema
- result=applicable なら finding/taxonomy 必須、unknown なら open_question 必須
- lens ID 重複禁止、core 9 lens + extra 最大3 の充足検証
- top-level decision と halt trigger/per-lens の整合 refine
- 注入候補と実際に引用した知見を区別

### その他
- intent の budget は provider 非依存の制約として定義（USD だけでは next と接続不可）
- データディレクトリ統一: data は $XDG_DATA_HOME/lane、config/budget は $XDG_CONFIG_HOME/lane。committable profile と runtime data を分離（.lane/ 全体 gitignore と .lane/profiles 参照の矛盾解消）

## 独断の裁定
- a（estimate 独立化）: 条件付き妥当 — revision 追記 + baseline 参照に変更が条件
- b（calibration_verdict 削除）: 妥当
- c（zod SSOT）: 条件付き妥当 — 生成 JSON Schema を commit/publish、Zod parse と JSON Schema validate の共通 fixture test 必須、Python pivot 後も生成済み JSON Schema を単独利用可能に

## v1 スコープ削減（9月末制約）
- legacy ledger 取り込みは一回限りの importer + reject report（汎用 migration CLI にしない）
- knowledge は append/query + critic top3 注入のみ（対話的 generalize importer / finish soft gate / 学習型 scoring を落とす）
- spec consensus の PR body 自動編集は後回し（digest 付き hard gate 優先）
- lane next は同一単位のみ fits/not_fit、他は advisory/unknown
- wall-clock は cycle_time_min として明示 or optional
- webhook emitter / 汎用 migration framework は作らない
- v1 の核: 「予測 revision → scoped telemetry → immutable calibration record の1周」「consensus hard gate」「next の透明な参考表示」「knowledge の決定論的 top3 注入」

## 課題9 裁定: M1 Go/No-Go = 2026-08-21 EOD hard checkpoint
すべて満たせば TS 継続、1つでも未達か残作業 p80 が 9/18 超なら Python pivot:
1. clean checkout の Node 22 で build/typecheck/test が通る
2. pnpm pack した CLI を空 temp repo に導入し、profile 指定込みで start→Phase4、差し戻し→再突入、status/validate が通る
3. phase transition / done overlay / ledger / Goodhart の critical parity fixture 100%
4. package cycle 0、境界に未検証 any / 二重 cast なし
5. M1 実績速度から M2/M3 code-complete を 9/18 以前と見積もれ、M4 に最低1週間残る
6. TS/ESM/package 設定の同一 blocker に1営業日以上停滞しない

## テスト戦略
- unit 数より「移植契約」優先: Python v0.7.8 と TS に同じ JSON fixture を与える differential test
- done overlay / ledger / Goodhart / telemetry window / schema の各不変条件 fixture（詳細はレビュー原文参照）
- CLI E2E は fake adapter、M4 dogfood だけ実 GitHub / 実 agent-cost
- 初日から Biome を入れる
