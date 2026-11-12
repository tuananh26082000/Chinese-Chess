# Cờ Tướng AI — Tài liệu tính năng & cách hoạt động

> **Đọc file này trước khi sửa code.** Mục đích: biết game *đang có gì*, các tính năng *liên kết với nhau thế nào*,
> mỗi tính năng *chạy ra sao* và *nằm ở đâu*, để AI/người bảo trì sửa đúng chỗ, không làm hỏng tính năng khác.
>
> - Quy tắc làm việc (test, tác động, cache): [CLAUDE.md](../CLAUDE.md) và [AI_GUIDELINES.md](AI_GUIDELINES.md).
> - Tên có tiền tố (`Game.setMode`, `Engine.getBestMove`…) là API **xuất ra** và được `tests/docs.test.js` kiểm tra còn tồn tại.
>   Tên không có tiền tố (`executeMove()` nội bộ, `analyzeLastMove()`…) là hàm riêng của module.
> - **Khi thêm/đổi/xóa tính năng, cập nhật file này** (mục 3–7) cùng lúc với code.

## Mục lục
1. [Tổng quan](#1-tổng-quan)
2. [Kiến trúc & phụ thuộc](#2-kiến-trúc--phụ-thuộc)
3. [Khái niệm & quy ước dùng chung](#3-khái-niệm--quy-ước-dùng-chung)
4. [Trạng thái (state)](#4-trạng-thái-state)
5. [Danh mục tính năng](#5-danh-mục-tính-năng)
6. [Luồng dữ liệu chính](#6-luồng-dữ-liệu-chính)
7. [Chế độ nào hiện gì](#7-chế-độ-nào-hiện-gì)
8. [Đổi X thì phải xem Y](#8-đổi-x-thì-phải-xem-y)
9. [Bản đồ test](#9-bản-đồ-test)
10. [Giới hạn đã biết & ý tưởng](#10-giới-hạn-đã-biết--ý-tưởng)
11. [Thuật ngữ](#11-thuật-ngữ)

---

## 1. Tổng quan

Web app tĩnh (HTML/CSS/JS thuần, **không có bước build**, không framework), dùng được trên máy tính và iPhone
(cài như app, chạy offline). Giao diện tiếng Việt.

| Nhóm | Tính năng |
|---|---|
| **Chơi** | **Menu chính** chọn chế độ (Người vs Máy 10 mức / Người vs Người / Phân tích), chọn màu, máy **đánh đa dạng** theo mức, đi lại (undo), lật bàn, gợi ý 1 nước, duyệt lịch sử, phím tắt |
| **Đánh giá** | Thanh đánh giá ngang (Đen/Đỏ) ở trên cùng, biểu đồ diễn biến, huy hiệu `!!` `!` `✓` `–` `?!` `?` `??` trên quân vừa đi, bảng chất lượng nước đi |
| **Phân tích thế cờ** | Gợi ý **3 biến** (chuỗi nước, có nước đối phương đáp), bộ lọc Tắt/Cả hai/Đỏ/Đen, mũi tên 3 màu, thanh gợi ý thu gọn được |
| **Xếp cờ** | Đặt/chuyển/xóa quân **tự do** (khay quân Đen trên + Đỏ dưới bàn), FEN, kiểm tra luật khi bấm "Phân tích" |
| **Học / Phân tích ván** | 8 bài học (FEN), tab phân tích cả ván từ danh sách nước đi |
| **Hạ tầng** | Engine Stockfish (WASM) + engine dự phòng, PWA offline, tự cập nhật, bố cục mobile |

Chạy: `python3 server.py` → http://localhost:8080 (server gửi header COOP/COEP để dùng Stockfish).
Test: `npm test` (Node ≥ 20, không cần cài gói).

---

## 2. Kiến trúc & phụ thuộc

Script nạp theo thứ tự trong `index.html` (biến toàn cục, không module):

```
xiangqi → engine → geometry → ui → editor → analyzer → lessons → pwa → main
```

| File | Biến toàn cục | Vai trò | Chạm DOM? |
|---|---|---|---|
| `js/xiangqi.js` | `XIANGQI` | **Luật cờ thuần**: sinh nước đi, chiếu, FEN, UCI, ký hiệu tiếng Việt, hết ván/hòa | Không |
| `js/engine.js` | `Engine` | Cầu nối Stockfish (Web Worker) + **engine dự phòng** alpha-beta, hàng đợi yêu cầu, MultiPV, chấm chất lượng nước đi | Chỉ thanh trạng thái engine |
| `js/geometry.js` | `Geometry` | **Toán thuần cho việc vẽ** (mũi tên, vị trí huy hiệu, tỉ lệ thanh đánh giá) — để test được | Không |
| `js/ui.js` | `UI` | Vẽ canvas bàn cờ, mũi tên, huy hiệu, thanh đánh giá, danh sách nước, toast | Có |
| `js/editor.js` | `BoardEditor` | Chế độ phân tích: gợi ý 3 biến + trình xếp cờ | Có |
| `js/analyzer.js` | `Analyzer` | Tab "Phân Tích Ván" (nhập danh sách nước, chấm từng nước) | Có |
| `js/lessons.js` | `LESSONS` | Dữ liệu 8 bài học (FEN) | Không |
| `js/pwa.js` | — | Đăng ký service worker, tự cập nhật, banner | Có |
| `js/main.js` | `Game` (`window.game`) | **Bộ điều khiển ván**: trạng thái, chế độ, lượt đi, AI, undo, điều hướng, kết thúc ván | Có |
| `sw.js` | — | Service worker (cache, offline) | — |
| `engine/` | — | Stockfish WASM (**mã bên thứ ba, không sửa**); chỉ `worker.js` là của dự án | — |

```
            ┌──────────── index.html (onclick → window.game / boardEditor / analyzer) ───────────┐
            ▼                                                                                    │
        ┌───────┐  gọi        ┌────────────┐  gọi   ┌────────┐                                   │
        │ main  │────────────►│   editor   │───────►│ engine │──► Worker(engine/worker.js) ──► Stockfish
        │ Game  │◄────────────│BoardEditor │        └───┬────┘        (không có → engine dự phòng)
        └──┬────┘ setPosition └─────┬──────┘            │ dùng
           │ gọi                    │ gọi               ▼
           ▼                        ▼              ┌─────────┐
        ┌──────┐    dùng       ┌──────────┐        │ xiangqi │  ← mọi module đều dùng luật cờ
        │  ui  │──────────────►│ geometry │        └─────────┘
        └──────┘               └──────────┘
```

Quy tắc phụ thuộc: `xiangqi` và `geometry` **không** phụ thuộc gì (thuần, dễ test). `main` và `editor` gọi lẫn nhau qua `window.game` /
`window.boardEditor` (có kiểm tra tồn tại). Mọi thứ nhìn thấy được qua `UI`; module khác **không** vẽ canvas trực tiếp.

---

## 3. Khái niệm & quy ước dùng chung

**Tọa độ.** `board[row][col]`, 10 hàng × 9 cột. `row 0` = hàng cuối của **Đen** (trên cùng), `row 9` = hàng cuối của **Đỏ**.
Chữ **HOA = Đỏ**, thường = Đen: `K/k` Tướng, `A/a` Sĩ, `B/b` Tượng, `R/r` Xe, `N/n` Mã, `C/c` Pháo, `P/p` Binh/Tốt.

**Ký hiệu nước đi.**
- **UCI** (`h3e3`, `a10a9`): cột `a`–`i` (trái → phải), hạng `1`–`10`, hạng 1 là hàng Đỏ. Ô `e1` = `[9][4]`. Dùng `XIANGQI.parseUCI` (trả `null` nếu sai, **luôn kiểm tra `null`**) / `XIANGQI.moveToUCI`.
- **Tiếng Việt ngắn** (`P2-5`, `M8.7`): `XIANGQI.moveToVietnamese`. **Đầy đủ** ("Pháo 2 bình 5"): `XIANGQI.moveToVietnameseFull`. Đỏ đếm cột từ phải sang trái; Đen từ trái sang phải; có `Tiền/Giữa/Hậu` khi nhiều quân cùng cột.

**Điểm số (centipawn, 100 = 1 quân Tốt).** Hai góc nhìn, **đừng nhầm**:

| Nơi | Góc nhìn |
|---|---|
| Kết quả `Engine.analyzePosition` / `Engine.analyzeMultiPV`, điểm trên thẻ gợi ý | **Bên đang đi** (`+` = tốt cho người sắp đi) |
| Thanh đánh giá ngang, biểu đồ, dòng "Đánh giá" của editor, `Engine.evalBoard`, `UI.setEvalBar` | **Quân Đỏ** (`+` = Đỏ hơn) |

Đổi sang góc nhìn Đỏ ở đúng một chỗ: `analyzeLastMove()` (main) và `redPov()` (editor). Chiếu bí = `±(99000 − số nước)`; `|điểm| > 9000` coi là chiếu bí.

**Hết nước đi = THUA** (không phải hòa). Hòa: lặp thế 3 lần, 120 nước không ăn quân, không đủ quân tấn công.

**Chống kết quả bất đồng bộ cũ.** Mọi việc chạy lâu (AI, gợi ý, phân tích) bắt token lúc bắt đầu và kiểm tra lại khi xong:
- `gameState.gameId` (tăng khi ván mới, undo, đổi chế độ, `setPosition`);
- `analysisToken` trong editor (mỗi lần phân tích thế cờ);
- `shouldAbort` truyền cho `Engine.analyzeMultiPV`.

**Bàn cờ "thật" và bàn cờ "đang xem".** `gameState.board` luôn là thế thật. Khi duyệt lịch sử chỉ `UI.state.board` đổi (`gameState.viewIdx`).

**Điểm số vs huy hiệu.** Điểm = thế cờ hiện tại hơn kém bao nhiêu. Huy hiệu = nước *vừa đi* kém hơn nước tốt nhất bao nhiêu
(mức thiệt `= điểm_tốt_nhất − điểm_sau_nước_đi`, theo góc nhìn người đi).

---

## 4. Trạng thái (state)

Ba đối tượng trạng thái; **chỉ ghi qua các hàm của chủ sở hữu** (đừng sửa chéo, trừ các trường UI ghi chú bên dưới).

### 4.1 `Game.getState()` — `gameState` trong main.js (nguồn sự thật của ván)

| Trường | Ý nghĩa |
|---|---|
| `board`, `turn`, `moveNumber` | Thế cờ **thật** hiện tại, bên đang đi (`'red'|'black'`), số nước |
| `mode` | `'pvai'` (Người vs Máy), `'pvp'` (Người vs Người), `'analyze'` (phân tích) |
| `playerColor`, `aiLevel` | Màu người chơi vs máy, mức máy 1–10 |
| `moveHistory[]` | Mỗi nước: `fromRow/fromCol/toRow/toCol`, `capturedPiece`, `piece`, `uci`, `vn`, `fen` (trước nước), `turnBefore`, `moveNumberBefore`, `key` (khóa thế cờ sau nước, để đếm lặp), `quality` (chất lượng, `null` nếu chưa/không đánh giá), `scoreBefore/scoreAfter` (**góc nhìn người đi**) |
| `boardHistory[]` | Bàn cờ sau mỗi nước (`[0]` = thế khởi đầu), dùng cho undo/điều hướng |
| `viewIdx` | `-1` = đang ở thế thật; `k` = đang xem thế sau `k` nước |
| `gameId` | Token chống kết quả cũ (xem mục 3) |
| `gameOver`, `isMoving`, `isAIThinking` | Cờ trạng thái; chặn thao tác chồng chéo |
| `analysisEnabled` | Nút "Phân tích" (bật/tắt **chấm điểm nước đi**) |
| `modeChosen` | `false` cho tới khi người chơi chọn một chế độ trong menu (quyết định có nút "Quay lại ván đang chơi" hay không) |
| `startKey` | Khóa thế cờ ban đầu (đếm lặp) |

### 4.2 `UI.state` — những gì canvas cần vẽ

`board` (bàn đang hiển thị), `selected`, `legalMoves` (chấm tròn), `lastMove`, `flipped`, `hintMove` (1 mũi tên gợi ý),
`evalHistory` (điểm cho biểu đồ), và các trường thêm động: `analysisVariations` + `activeVariationIdx` (mũi tên các biến),
`moveBadge` (`{row, col, quality}` — huy hiệu trên quân vừa đi). Các trường `animPiece`, `analysis`, `moveQualityMap` là tàn dư, không dùng.

### 4.3 `BoardEditor.getState()` — editor.js

| Trường | Ý nghĩa |
|---|---|
| `subMode` | `'play'` (phân tích: đi thử + gợi ý) hoặc `'edit'` (xếp cờ) |
| `selectedTool` | `'move'` (chuyển quân), `'delete'`, hoặc chữ quân (`'R'`, `'p'`…) để đặt |
| `selectedSquare` | Quân đang được nhấc (công cụ `move`) |
| `autoAnalyze` | Ô "Tự động": tự tính gợi ý khi thế cờ đổi |
| `suggestFilter` | `'off' | 'both' | 'red' | 'black'` (lưu `localStorage` khóa `cotuong.suggestFilter`) |
| `variations[]` | 3 biến hiện có (đã định dạng: `myMoveVN`, `counterMoveVN`, `pv`, `score`…) |
| `activeVariationIdx` | Biến đang được làm nổi bật |
| `sheetCollapsed` | Thanh gợi ý (mobile) đang thu gọn |
| `startErrors` | Danh sách lỗi của lần bấm "Phân tích" bị từ chối gần nhất |

**Ba công tắc độc lập** hay bị nhầm: `analysisEnabled` (chấm nước đi → huy hiệu, bảng chất lượng) ≠ `autoAnalyze` (tự tính gợi ý 3 biến)
≠ `suggestFilter` (gợi ý cho bên nào).

---

## 5. Danh mục tính năng

Mỗi mục: **Người dùng thấy gì → Cách hoạt động → Liên kết → Test → Lưu ý.**

### F1. Menu chính & chế độ chơi (`Game.setMode`, `Game.showMenu`, `Game.hideMenu`)
- **Thấy:** khi mở app (sau màn hình chờ) là **menu chính** toàn màn hình với 3 thẻ: **Người vs Máy** (kèm thanh *độ khó* 1–10 và chọn *màu quân*), **Người vs Người**, **Phân tích**.
  Chọn một chế độ → menu **ẩn**, ván mới bắt đầu. Trên bàn cờ có nút **☰ chip** ghi chế độ hiện tại (vd "Người vs Máy · Khó"), bấm để mở lại menu; menu mở lại có nút **"↩ Quay lại ván đang chơi"** (chỉ khi đã chọn chế độ), hoặc phím `Esc`.
- **Quy tắc:** **chọn chế độ = reset bàn cờ**, kể cả chọn lại đúng chế độ đang dùng. Mức khó và màu quân chỉ là **cài đặt**: đổi chúng không đụng tới ván đang chơi, chúng có hiệu lực ở ván bắt đầu từ menu.
- **Chạy:** `setMode(mode, fen=null)` → đặt `mode`, `modeChosen=true`, `gameId++`, hủy AI đang nghĩ → hiện/ẩn khối giao diện (mục 7) → `BoardEditor.setActive` → `updateModeChip()` → `hideMenu()` → `newGame(fen)`
  (reset; máy đi trước nếu người cầm Đen; chế độ phân tích thì đồng bộ editor). Menu mở thì bấm bàn cờ và phím tắt bị bỏ qua (`isMenuOpen()`); `body.menu-open` khóa cuộn.
- **Liên kết:** F4 (mức máy/màu), F12/F13 (phân tích/xếp cờ qua `BoardEditor.setActive/syncFromGame`), F15 (bài học gọi `setMode('analyze', fen)`), F17 (banner cập nhật coi phân tích là "đang làm dở").
- **Test:** `tests/menu.test.js`, `tests/game.test.js`, `tests/layout.test.js`. **Lưu ý:** nút "Xếp cờ thế" khi đang ở chế độ chơi cũng đổi sang chế độ phân tích nên **reset ván**.

### F2. Luật cờ (`XIANGQI`)
- **Chạy:** `movesForPiece` (giả hợp lệ) → lọc bằng `isSafeMove` (đi xong tướng mình không bị chiếu). `isInCheck` tra từ ô Tướng
  (Xe/Pháo theo tia, Mã có chặn chân, Binh, tướng đối mặt). `getGameState` → `'playing' | 'checkmate' | 'stalemate'`.
  `parseFEN` **kiểm tra chặt** (10 hàng × 9 cột, ký tự lạ, đúng 1 Tướng/bên, bên không đi không bị chiếu) và ném lỗi.
  `getLegalMoves` thay đổi bàn tạm thời rồi khôi phục (make/unmake) — không sao chép.
- **Test:** `tests/xiangqi.test.js` — gồm **perft 44/1920/79666** (hễ sai là luật hỏng). **Lưu ý:** không hỗ trợ luật chiếu liên tục/đuổi liên tục.

### F3. Đi một nước (`handleSquareClick` → `executeMove`)
- **Thấy:** chạm quân → hiện chấm các ô đi được → chạm ô đích → quân trượt tới.
- **Chạy:** xem luồng 6.1. Bấm bàn cờ khi đang duyệt lịch sử → quay về thế thật. Ở xếp cờ mọi cú bấm thuộc editor (F13).
- **Liên kết:** F4 (lượt máy), F6 (chấm nước), F10 (hết ván), F9 (lịch sử), F12 (cập nhật gợi ý).

### F4. Máy đánh & độ khó (`makeAIMove`)
- **Chạy:** sau nước của người, `setTimeout` rồi `makeAIMove()`: `depth = min(3 + ⌊level×0.8⌋, 12)`, `time = 500 + level×200` ms →
  `Engine.getBestMove(fen, depth, time, { variety })` → kiểm tra `isLegalMove` → `executeMove(..., isAI=true)`. Hủy nếu `gameId`/`mode` đã đổi (vd người mở menu và chọn lại chế độ).
- **Độ khó = độ sâu/thời gian tìm kiếm + độ đa dạng.** Mức càng cao càng sâu và càng ít "lệch" khỏi nước tốt nhất.
- **Đa dạng (để ván nào cũng khác):** máy không luôn chơi nước tốt nhất duy nhất. `Engine.varietyForLevel(level, plyCount)` cho `margin` (centipawn máy được phép kém nước tốt nhất):
  **mức 10 → `margin 0` (luôn nước chuẩn nhất, không ngẫu nhiên)**; mức 9 → 25; mỗi mức thấp hơn rộng thêm 20 (mức 1 → 185); **10 nước đầu rộng thêm 30** (trừ mức 10).
  `Engine.pickMove(candidates, {margin, rng})` chọn **có trọng số** (`e^(-thiệt/(margin/2))`, nước tốt hơn dễ được chọn hơn) trong các nước **trong biên**; **không bao giờ** bỏ qua nước thắng cưỡng bức, không chọn nước dẫn tới bị chiếu bí cưỡng bức.
  Stockfish: hỏi **MultiPV 4** rồi chọn trong 4 nước (chỉ lấy kết quả sâu nhất của mỗi dòng); `margin 0` → hỏi **MultiPV 1**. Engine dự phòng: sau khi tìm nước tốt nhất, tìm thêm các nước trong biên bằng cửa sổ hẹp (`searchFallback(..., variety)`).
- **Lưu ý:** nước của máy **không được chấm huy hiệu**; thanh đánh giá sau nước máy dùng `Engine.evalBoard` (chỉ đếm quân). Engine dự phòng có thể coi nhiều nước điểm bằng nhau → mức 10 vẫn có thể đa dạng giữa các nước **hòa điểm**.
- **Test:** `tests/engine.test.js` ("Variety"), `tests/engine.worker.test.js` (đường Stockfish), `tests/game.test.js` ("AI variety").

### F5. Engine (`Engine`)
- **Hai đường:** (1) **Stockfish** qua `new Worker('engine/worker.js')` — chỉ khi có `SharedArrayBuffer` (cần header COOP/COEP, xem F17);
  (2) **engine dự phòng** alpha-beta (negamax, sắp xếp ăn quân, tìm kiếm tĩnh, giới hạn thời gian, **chạy đồng bộ** trên luồng chính). Tự chọn lúc `Engine.init()`.
- **API:** `getBestMove(fen, depth, ms, {variety, rng})` → UCI/`null` (`variety` từ `Engine.varietyForLevel`; `Engine.pickMove` chọn nước); `analyzePosition(fen, depth)` → `{score, bestMove}` (góc nhìn bên đi);
  `analyzeMultiPV(fen, depth, n, onProgress, {shouldAbort})` → `{variations, bestMove, aborted}`; `stopAnalysis()`; `classifyMoveQuality`; `QUALITY`.
- **Hàng đợi:** mọi yêu cầu chạy **tuần tự** (`enqueue`) vì worker chỉ chạy một tìm kiếm. Tìm kiếm quá hạn → gửi `stop`, bỏ qua `bestmove` muộn (`ignoreBestmove`).
- **`stopAnalysis()` chỉ ngắt `analyzeMultiPV`** (job `interruptible`), **không** ngắt chấm nước đi / nước máy / gợi ý.
- **Variation:** `{rank, score, isMate, mateIn, depth, pv[], firstMove, counterMove, followupMove}`.
- **Test:** `tests/engine.test.js` (chế độ dự phòng), `tests/engine.worker.test.js` (worker giả: `stop`, thứ tự hàng đợi).

### F6. Chấm nước đi & huy hiệu
- **Thấy:** huy hiệu tròn góc trên-phải quân vừa đi + thẻ "chất lượng" bên cạnh (chế độ chơi).
- **Chạy:** `executeMove` (nếu `analysisEnabled` và là nước của người, **kể cả chế độ phân tích**) → `analyzeLastMove()`: 2 lần `analyzePosition`
  (thế trước, thế sau; depth 8) → `classifyMoveQuality(best, after)` → lưu `moveRecord.quality/scoreBefore/scoreAfter` →
  `refreshMoveBadge()` đặt `UI.state.moveBadge` suy ra từ **nước đang xem** → `UI.render`. Ngưỡng mức thiệt: `<−0.50 !!`, `<0.20 !`, `<0.50 ✓`,
  `<0.80 –`, `<1.50 ?!`, `<3.00 ?`, còn lại `??`.
- **Vẽ:** `drawMoveBadge()` (ui.js) dùng `Geometry.badgePoint` (kẹp trong canvas). Màu/ký hiệu ở `Engine.QUALITY` (khớp `--quality-*` trong CSS, có test).
- **Xóa huy hiệu:** nước mới (chưa chấm), ván mới, `setPosition`; undo/điều hướng thì hiện huy hiệu của nước tương ứng.
- **Test:** `tests/game.test.js` (nhóm "badge"), `tests/engine.test.js`, `tests/geometry.test.js`.

### F7. Hiển thị đánh giá thế cờ
- **Thanh ngang trên cùng** (`#eval-hbar`): Đen bên trái, Đỏ bên phải, bên hơn dài hơn, số ở giữa (`+1.08`, `Chiếu bí`, `—`).
  `Geometry.evalBarSplit(score)` tính tỉ lệ bằng `tanh(score/800)`, mỗi màu luôn còn ≥ 4%. `UI.setEvalBar(score)` chỉ vẽ lại;
  `UI.updateEvalBar(score)` = vẽ lại **+ thêm điểm vào biểu đồ** (`evalHistory`).
- **Ai cập nhật:** chế độ chơi → sau chấm nước (`analyzeLastMove`), sau nước máy (`Engine.evalBoard`), điều hướng lịch sử (`showHistoricalAnalysis`, chỉ `setEvalBar`);
  chế độ phân tích → `BoardEditor` (`updateEvalScoreUI` gọi `UI.setEvalBar`, `null` khi gợi ý tắt/đang xếp cờ).
- **Biểu đồ** (`#eval-chart`, panel "Diễn biến đánh giá"): giới hạn ±10, đường giữa là cân bằng.
- **Test:** `tests/geometry.test.js` (evalBarSplit), `tests/game.test.js`, `tests/editor.test.js`, `tests/layout.test.js`.

### F8. Nút Gợi ý (chỉ chế độ chơi)
- **Thấy:** nút "Gợi ý" dưới bàn cờ (phím `H`) → **một** mũi tên + dòng "💡 Gợi ý: …".
- **Chạy:** `requestHint()` → `Engine.analyzeMultiPV(fen, 10, 1)` → `UI.state.hintMove = best.firstMove`. Bị chặn khi đang ở `analyze`, đang máy nghĩ/đi, hoặc không tới lượt người.
  Ẩn nút ở chế độ phân tích (`setMode`); nước đi kế tiếp xóa mũi tên.

### F9. Đi lại & duyệt lịch sử
- **Chạy:** `undoMove()` (PvAI lùi đến khi tới lượt người; không cho undo nước mở đầu của máy; chặn khi máy đang nghĩ). Khôi phục `turn`/`moveNumber` từ bản ghi.
  `goToMove(k)` đặt `viewIdx`, chỉ đổi `UI.state.board`; về cuối = `returnToCurrentPosition()`. Nút ⏮◀▶⏭ khóa ở hai đầu (`updateNavButtons`).
  Phím: `←` `→` `↑` (về đầu) `↓` (về cuối), `Ctrl+Z`, `H`, `F` (lật), `Esc` (bỏ chọn/mũi tên).
- **Liên kết:** F6 (huy hiệu theo nước đang xem), F7 (thanh đánh giá theo nước đang xem, **không** thêm điểm vào biểu đồ).

### F10. Kết thúc ván
- `executeMove` → `getGameState`: chiếu bí "Chiếu bí!", hết nước "Vây bí!" (đối phương thắng); `detectDraw()` → "Hòa!". `showGameOver` hiện hộp thoại + thống kê (số nước, `!!`, `?`, `??`).

### F11. FEN & danh sách nước
- Ô FEN (panel phải): `Game.loadFEN` (báo lỗi chi tiết từ `parseFEN`), `Game.copyFEN`. Danh sách nước dùng ký hiệu ngắn, bấm để nhảy tới nước (`goToMove`), tô màu theo chất lượng.

### F12. Phân tích thế cờ: gợi ý 3 biến (`BoardEditor`, `subMode='play'`)
- **Thấy:** tab "Phân tích" → thanh gợi ý (đáy màn hình trên mobile): bộ lọc **Tắt/Cả hai/Chỉ Đỏ/Chỉ Đen**, ô "Tự động", nút "🔍 Phân tích",
  3 thẻ một dòng `[hạng] Bạn <nước> ➔ Đối thủ <nước> điểm [♟️ Đi]`, thẻ đang chọn hiện thêm chuỗi nước đánh số. Trên bàn cờ: **3 màu** (xanh lá/xanh dương/cam) = 3 biến,
  **nét liền** = nước của bạn, **nét đứt** = đối thủ đáp, **số** = thứ tự (tối đa 4). 3 biến là **3 lựa chọn khác nhau**, không đi liên tiếp.
- **Chạy:** `analyzeCustomBoard()`: token → `Engine.stopAnalysis()` → (đang xếp cờ → báo "Đang xếp cờ", dừng) → `validateBoard()` (sai → hiện lỗi, dừng) →
  **bộ lọc** `shouldSuggest(turn)` (bên không được gợi ý → xóa mũi tên, **không gọi engine**) → `Engine.analyzeMultiPV(fen, 10, 3, onProgress, {shouldAbort})` →
  `formatVariationDetails` → `renderVariationsUI` + `UI.setAnalysisVariations` + `UI.setEvalBar`.
- **Khi nào tự chạy:** sau mỗi nước (150 ms, hook trong `executeMove`), khi đổi bộ lọc (luôn chạy), khi vào/ra xếp cờ; `scheduleAnalysis()` debounce 250 ms và chỉ khi `autoAnalyze` và `subMode==='play'`.
- **Vẽ:** `XIANGQI.pvToSegments(board, pv, 4)` chơi chuỗi nước trên bản sao bàn để mỗi mũi tên bắt đầu đúng chỗ; `drawArrows()` (ui.js) (vẽ **sau** quân); `Geometry.arrowPoints` (đầu mũi tên chạm **đúng tâm ô đích**).
- **Mobile:** `#main-analysis-card` là *bottom sheet* cố định (**tối đa 25dvh**, mỗi biến một dòng, ẩn chú giải và điểm tổng) — luôn hiện để vừa xem gợi ý vừa đánh cờ; thu gọn tay được thành 1 dòng tóm tắt (`#sheet-summary`), tự thu gọn khi xếp cờ; hàng nút dưới bàn là một hàng icon; `body.analysis-mode` / `body.sheet-collapsed` chừa chỗ.
- **Test:** `tests/editor.test.js`, `tests/xiangqi.test.js` (`pvToSegments`), `tests/geometry.test.js`.

### F12b. Công tắc "Máy đi" (chế độ phân tích, `Game.toggleEngineAutoPlay`)
- **Thấy:** nút "Máy đi" (`#btn-engine-move`) trong hàng nút dưới bàn cờ, chỉ hiện ở chế độ phân tích. Khi bấm mở popup chọn bên: **Chỉ quân Đỏ**, **Chỉ quân Đen**, hoặc **Cả hai bên**. Chọn xong popup tự đóng trả lại giao diện thông thoáng. Bật → nút sáng, nhãn đổi thành "Dừng máy" (hoặc "Dừng (Đỏ)" / "Dừng (Đen)"); máy tự đi theo bên đã chọn (nếu chọn một bên thì máy đợi người chơi đi bên còn lại rồi đi tiếp). Bấm lại để tắt **bất cứ lúc nào**.
- **Chạy:** `runEngineAutoPlay` lặp: kiểm tra lượt đi (nếu chọn một bên thì đợi lượt của bên đó), gọi `requestEngineMove()` (`Engine.getBestMove(fen, 10, 1500)`, không đa dạng → kiểm tra `gameId`/`isLegalMove` → `executeMove(..., isAI=true)`) → nghỉ 400 ms → lặp. Tự tắt khi hết ván, ván mới / đổi chế độ / `setPosition` / undo (mọi chỗ tăng `gameId`), vào xếp cờ, hoặc máy không tìm được nước. Nước của máy không chấm huy hiệu; thanh đánh giá do editor cập nhật qua gợi ý 3 biến.
- **Test:** `tests/editor.test.js` (nhóm "Máy đi").

### F13. Xếp cờ tự do (`BoardEditor`, `subMode='edit'`)
- **Thấy:** nút "Xếp cờ thế"/tab "Xếp / Sửa cờ" → màn hình xếp cờ: công tắc **lượt đi** + dải **quân Đen** trên bàn, bàn cờ, dải **quân Đỏ** dưới bàn,
  ô **FEN** (nút sao chép), thanh công cụ **Xoá / Cài lại / Lật bàn / Phân tích** (cố định đáy màn hình trên mobile). Dưới bàn (panel): đếm quân, công cụ Chuyển quân/Xóa quân.
- **Chạy — tự do hoàn toàn:** công cụ `move`: chạm **bất kỳ quân nào** (Đỏ hoặc Đen, không theo lượt) rồi chạm **ô trống bất kỳ**. Chạm quân ở khay rồi chạm ô để đặt (đè lên quân khác được).
  **Không** chặn luật, **không** cảnh báo luật, **không** chấm gợi ý, **không** chạy engine, kể cả sai luật/xóa Tướng. **Ngoại lệ duy nhất: khay hết quân** (vd đã đủ 5 Tốt) thì từ chối đặt thêm và hiện toast "Hết … trong khay"; muốn đặt tiếp phải xóa bớt. Chuyển quân không bị ảnh hưởng. Mọi chỉnh sửa đi qua `commit()` → `Game.setPosition()` (lịch sử bắt đầu lại từ thế này).
- **Kiểm tra khi bấm "Phân tích"** (`startAnalysis` → `setSubMode('play')` → `validateBoard()`): Tướng/Sĩ trong cung, Tượng không qua sông, Tốt đúng chỗ, hai Tướng không đối mặt,
  đủ 2 Tướng, không thừa quân, bên không đi không bị chiếu. Có lỗi → toast "Phát hiện quân cờ không hợp lệ: …" + danh sách **đầy đủ** trong khung tóm tắt, **ở lại xếp cờ**; sửa xong danh sách tự mất. Hết lỗi → vào phân tích (F12).
- **Thoát:** `Game.setMode` sang chế độ khác → `setActive(false)` → `leaveEditing()` (thoát sạch, không chạy engine). Bài học luôn vào `subMode='play'`.
- **Trạng thái giao diện:** `setEditChrome(on)` bật/tắt turn bar, 2 khay, FEN row, toolbar và `body.edit-mode` (mobile ẩn các khối thừa để vừa một màn hình).
- **Test:** `tests/editor.test.js` (nhóm "free setup", "Setup screen"), `tests/layout.test.js`.

### F14. Phân Tích Ván (tab riêng, `Analyzer`)
- Nhập FEN (tùy chọn) + danh sách nước UCI → `Analyzer.startAnalysis`: kiểm tra từng nước (định dạng + `isLegalMove`, báo rõ nước nào sai), chấm bằng `analyzePosition(depth 6)` hai lần/nước, hiện tổng kết độ chính xác + chi tiết từng nước. Độc lập với F12. **Test:** `tests/analyzer.test.js`.

### F15. Bài học (`LESSONS`, tab "Học")
- 8 thẻ; bấm → `Game.loadLesson(fen)`: về tab chơi, `setMode('analyze')`, `newGame(fen)` (`null` = thế chuẩn), `setSubMode('play')`. FEN mỗi bài phải hợp lệ (test kiểm tra).

### F16. Bố cục mobile (≤ 768 px) & chế độ
- `.game-layout` đổi sang flex dọc; `.panel-left/.panel-right { display: contents }` để dùng CSS `order` xếp lại: **thanh đánh giá → chip chế độ ☰ + bàn cờ → panel phân tích → …** (chọn chế độ nằm ở menu chính, không chiếm chỗ).
- Phân tích: bottom sheet (F12). Xếp cờ: `body.edit-mode` ẩn khối thừa + toolbar cố định (F13). `--sheet-h` do `ResizeObserver` đặt. Vùng an toàn iPhone: `env(safe-area-inset-*)`.
- Mục tiêu chạm ≥ 40 px. Toast nằm trên thanh gợi ý/toolbar.

### F17. PWA, offline, cập nhật, header bảo mật
- **Offline:** `sw.js` precache toàn bộ file (`PRECACHE`, gồm `engine/*.wasm`), trang và script **cùng một cache cùng phiên bản** (không bao giờ "HTML mới + JS cũ").
  Phiên bản mới tải bằng `cache: 'reload'`. **Thêm/đổi tên/xóa file tĩnh → cập nhật `PRECACHE` và tăng `CACHE_VERSION`.**
- **Cập nhật:** `pwa.js` — khi bản mới nhận quyền: tự tải lại nếu không mất gì, nếu đang có ván/phân tích thì hiện banner `#update-banner`. App cài sẽ kiểm tra cập nhật mỗi khi quay lại màn hình.
- **localhost:** không dùng service worker (sửa code thấy ngay); `?sw` để thử; worker cũ còn sót tự bị gỡ.
- **Header:** `_headers` (Netlify) và `server.py` gửi `Cross-Origin-Opener-Policy: same-origin` + `Cross-Origin-Embedder-Policy: require-corp` → có `SharedArrayBuffer` → dùng Stockfish. Thiếu thì tự rơi về engine dự phòng ("Engine nội bộ (yếu hơn)").
- **Triển khai Netlify:** kéo `index.html manifest.json sw.js _headers css/ js/ engine/ icons/`. Stockfish là **GPLv3** (cần tuân thủ khi công khai).
- **Test:** `tests/pwa.test.js`.

### F18. Giao diện khác
- Chữ giữa bàn cờ "Cờ Tướng" / "Fsoft" (`RIVER_TEXT` trong `ui.js`, không đảo khi lật). Quân chỉ hiện chữ Hán. Icon quân Đỏ 帥 (`swift scripts/make-icons.swift`).
- Toast (`UI.showToast`), splash, hộp thoại kết thúc ván, tên người chơi theo màu.

---

## 6. Luồng dữ liệu chính

### 6.1 Người đi một nước (chế độ chơi)
```
bấm ô ─► handleSquareClick (chặn nếu gameOver/AI nghĩ/đang trượt; đang xem lịch sử → về thế thật)
   ├─ edit mode?  ─► BoardEditor.handleEditorClick (F13) và dừng
   ├─ chọn quân   ─► UI.state.selected + legalMoves (XIANGQI.getLegalMovesForPiece) ─► UI.render
   └─ bấm ô đích  ─► executeMove(from, to)
        1. isMoving=true; UI.animateMove
        2. XIANGQI.applyMove → gameState.board; ghi moveRecord (turnBefore, key…); boardHistory.push
        3. đổi lượt; UI.state.moveBadge=null; getGameState (hết ván? → F10) ; detectDraw()
        4. UI.updateTurnIndicator/updateMoveHistory/updateNavButtons/render
        5. mode='analyze' & autoAnalyze → sau 150ms BoardEditor.analyzeCustomBoard()   (F12)
        6. analysisEnabled & nước của người → analyzeLastMove()  (không await)         (F6)
              └─ 2×Engine.analyzePosition → quality → refreshMoveBadge → UI.showMoveQuality/setEvalBar…
        7. mode='pvai' & tới lượt máy → setTimeout → makeAIMove()                      (F4)
```
Các kết quả bất đồng bộ (6, 7, 5) đều so `gameId` trước khi áp dụng.

### 6.2 Vào / ra chế độ phân tích và xếp cờ
```
Game.setMode('analyze') ─► gameId++, hủy AI ─► hiện panel phân tích, ẩn hint/AI/player cards ─► hideMenu
        ├─ BoardEditor.setActive(true)  ─► body.analysis-mode
        └─ newGame() ─► RESET bàn cờ ─► BoardEditor.syncFromGame() ─► cập nhật khay/FEN/lượt, scheduleAnalysis()  (nếu subMode='play')
"Xếp cờ thế" / tab Xếp ─► BoardEditor.setSubMode('edit') ─► applySubMode: cancelAnalysis, setEditChrome(true), sheet thu gọn
        mỗi chỉnh sửa ─► commit ─► Game.setPosition ─► updatePaletteCounts (FEN, đếm quân, xóa startErrors)
"Phân tích" ─► setSubMode('play'): validateBoard()
        ├─ lỗi  ─► reportStartErrors (toast + khung), vẫn ở 'edit'
        └─ ổn   ─► applySubMode('play'): setEditChrome(false), analyzeCustomBoard()
Game.setMode('pvp'|'pvai') ─► BoardEditor.setActive(false) ─► leaveEditing() (thoát sạch) ─► newGame() (reset)
```

### 6.3 Một vòng gợi ý trong phân tích
`analyzeCustomBoard` (xem F12) → khi engine trả về từng độ sâu, `onProgress` cập nhật thẻ/mũi tên (bỏ qua nếu `isStale`) → khi xong, chọn biến 1 làm active.
Bấm thẻ → `setActiveVariation` (làm nổi bật + vẽ lại). Bấm "♟️ Đi" → `applyVariation` → `Game.executeMove` → quay lại 6.1 (bước 5 chạy gợi ý mới, bước 6 chấm nước vừa đi).

### 6.4 Khởi động
`DOMContentLoaded` → `Game.init()`: `newGame()` → `Engine.init()` (Stockfish nếu có SAB, ngược lại dự phòng; timeout 12 s) → ẩn splash → `showMenu()` (menu chính) → gắn sự kiện. `BoardEditor.init()` khôi phục bộ lọc từ `localStorage`.

---

## 7. Chế độ nào hiện gì

Menu chính (`#main-menu`) phủ toàn màn hình khi mở app và khi bấm chip ☰; mức máy và màu quân nằm **trong menu**. Bảng dưới là giao diện **sau khi** chọn chế độ.

| | **Chơi (pvai / pvp)** | **Phân tích · đi thử** (`analyze`/`play`) | **Phân tích · xếp cờ** (`analyze`/`edit`) |
|---|---|---|---|
| Thanh đánh giá ngang | ✔ (theo chấm nước) | ✔ (theo gợi ý) | `—` |
| Chip ☰ mở menu (đổi chế độ = reset) | ✔ | ✔ | (mobile: ẩn) |
| Thẻ người chơi | ✔ | ẩn | (mobile: ẩn) |
| Nút **Gợi ý** (1 nước) | ✔ | **ẩn** | — |
| Thẻ "chất lượng nước đi" | ✔ | ẩn | ẩn |
| Huy hiệu trên quân | ✔ (nước người) | ✔ (cả hai bên) | — |
| Thanh gợi ý 3 biến | ẩn | ✔ (bottom sheet trên mobile) | ẩn/thu gọn |
| Khay quân, FEN row, toolbar xếp cờ | ẩn | ẩn | ✔ |
| Bấm bàn cờ | đi quân theo luật & lượt | đi quân theo luật (cả hai bên) | đặt/chuyển/xóa quân tự do |
| Engine chạy | AI + chấm nước + gợi ý | chấm nước + 3 biến | **không** |

---

## 8. Đổi X thì phải xem Y

| Nếu bạn đổi… | Hãy kiểm tra / cập nhật… |
|---|---|
| Mức khó / độ đa dạng của máy | `Engine.varietyForLevel` + `pickMove` (mức 10 phải luôn `margin 0`), `makeAIMove` (depth/time), `tests/engine*.test.js`, `tests/game.test.js` |
| Thêm chế độ chơi mới / đổi menu | `#main-menu` trong `index.html`, `setMode`/`MODE_NAMES`/`updateModeChip`, bảng mục 7, `tests/menu.test.js`, `tests/layout.test.js` |
| Luật cờ, FEN, ký hiệu (`xiangqi.js`) | **Mọi thứ** dùng nó; perft phải giữ 44/1920/79666; `tests/xiangqi.test.js` |
| Dạng điểm / `analyzePosition` / `analyzeMultiPV` | góc nhìn điểm (mục 3); `analyzeLastMove`, `redPov`, `tests/engine*.test.js`, `tests/editor.test.js` |
| Cấu trúc `moveHistory` / `boardHistory` | undo, điều hướng, `refreshMoveBadge`, thống kê cuối ván, `UI.updateMoveHistory`, `detectDraw` |
| Thêm chỗ đổi vị trí/lịch sử | gọi `refreshMoveBadge()` hoặc đặt `UI.state.moveBadge=null`; tăng `gameId` nếu hủy việc đang chạy |
| Thêm việc bất đồng bộ | bắt token `gameId` (hoặc `analysisToken`) và kiểm tra trước khi áp dụng kết quả |
| Gọi engine mới | qua `Engine.*` (hàng đợi); nếu cần ngắt được thì làm thành `interruptible` như `analyzeMultiPV` |
| Id phần tử trong `index.html` | mọi `getElementById` và `onclick`; `tests/layout.test.js` sẽ báo id/onclick bị gãy |
| Thêm/đổi tên/xóa **file tĩnh** (JS/CSS/ảnh/engine) | `PRECACHE` + `CACHE_VERSION` trong `sw.js`, thẻ `<script>` đúng thứ tự, `tests/pwa.test.js` |
| Màu chất lượng nước đi | `Engine.QUALITY` **và** `--quality-*` trong CSS (có test đối chiếu) |
| Mũi tên / huy hiệu / thanh đánh giá | logic tính ở `geometry.js` (+ test), `ui.js` chỉ vẽ |
| Chế độ mới / panel mới | `setMode` (hiện/ẩn khối), bảng ở mục 7, CSS mobile (`order`, `body.*` class) |
| Bố cục mobile | khối `@media (max-width: 768px)` cuối `css/style.css` (trước khối PWA); thanh cố định phải tính `--sheet-h` / `env(safe-area-inset-bottom)` |
| Header COOP/COEP, font/CDN ngoài | `_headers`, `server.py`; COEP chặn tài nguyên cross-origin không có CORP |
| Giao diện xếp cờ | `EDIT_CHROME` + `setEditChrome` (editor.js), `body.edit-mode` (CSS), các id `editor-*` |

---

## 9. Bản đồ test

`npm test` chạy toàn bộ `tests/*.test.js` bằng `node:test`, không dùng trình duyệt: DOM/`UI`/`navigator` được **giả lập** (`tests/helpers.js`).

| File | Bảo vệ |
|---|---|
| `xiangqi.test.js` | Luật cờ, perft, FEN, UCI, ký hiệu Việt, `pvToSegments`, hòa |
| `engine.test.js` | Engine dự phòng, `analyzeMultiPV`, phân loại chất lượng, `QUALITY` khớp CSS, **độ đa dạng** (`varietyForLevel`, `pickMove`, mức 10 chính xác) |
| `engine.worker.test.js` | Đường Stockfish bằng Worker giả: `stop` chỉ ngắt phân tích, thứ tự hàng đợi, MultiPV khi cần đa dạng |
| `geometry.test.js` | Mũi tên chạm đích, huy hiệu trong khung, `evalBarSplit` |
| `game.test.js` | Vòng đời ván: đi, undo, duyệt, kết thúc, AI, gợi ý 1 nước, huy hiệu, thanh đánh giá khi duyệt |
| `editor.test.js` | Gợi ý 3 biến, bộ lọc, bottom sheet, xếp cờ tự do, kiểm tra khi bấm "Phân tích", FEN/khay/toolbar |
| `menu.test.js` | Menu chính: mở khi khởi động, chọn chế độ = reset ván, chip, quay lại ván, cài đặt không đụng ván, Esc/phím tắt khi menu mở |
| `analyzer.test.js` | Tab "Phân Tích Ván" |
| `pwa.test.js` | Service worker, cache cùng phiên bản, `pwa.js` (đăng ký, cập nhật, localhost) |
| `layout.test.js` | **Dây nối** `index.html` ↔ JS: id tồn tại, `onclick` trỏ đúng hàm, vị trí thanh đánh giá/khay/toolbar |
| `docs.test.js` | Tài liệu này không nhắc tới API đã bị xóa |

**Không có** test cho phần vẽ canvas thật và CSS (xem `AI_GUIDELINES.md`: chỉ cần unit test). Kiểm tra dây nối DOM thật chỉ có thể làm thủ công/jsdom tạm, không nằm trong repo.

---

## 10. Giới hạn đã biết & ý tưởng

- **Nước của máy không có huy hiệu** (mỗi nước máy cần thêm 2 lần tìm kiếm). Có thể thêm nếu chấp nhận chậm.
- **Engine dự phòng chạy đồng bộ** trên luồng chính và chỉ đếm quân + Tốt tiến → yếu, và có thể làm đứng giao diện vài trăm ms. Dùng Stockfish (COOP/COEP) để có chất lượng thật.
- **Biểu đồ đánh giá:** `undoMove` không bớt điểm khỏi `evalHistory`; điểm sau nước máy là "đếm quân", lẫn với điểm engine.
- Một số quy tắc luật chưa có: chiếu/đuổi liên tục.
- CSS còn quy tắc cũ không dùng (thanh dọc cũ, palette cũ) — an toàn để dọn.
- Tên "Chiếu bí" dùng cho cả thông báo ván và thanh đánh giá.

---

## 11. Thuật ngữ

| Tiếng Việt | Ý nghĩa / ký hiệu |
|---|---|
| Tướng 帥/將 `K/k` · Sĩ 仕/士 `A/a` · Tượng 相/象 `B/b` · Xe 俥/車 `R/r` · Mã 傌/馬 `N/n` · Pháo 炮/砲 `C/c` · Binh/Tốt 兵/卒 `P/p` | Quân cờ (HOA = Đỏ) |
| Cung | Vùng 3×3 của Tướng/Sĩ (cột d–f, hàng 1–3 hoặc 8–10) |
| Sông | Ranh giới giữa hai nửa; Tượng không qua; Tốt qua sông mới đi ngang |
| Lộ mặt Tướng | Hai Tướng cùng cột không có quân giữa (cấm) |
| Chiếu bí / Vây bí | Hết nước đi khi đang bị chiếu / khi không bị chiếu (đều **thua**) |
| Biến | Một chuỗi nước đi (nước của bạn, đối thủ đáp, …) engine đề xuất |
| Nước phản đòn / đáp | Nước đối thủ tốt nhất sau nước của bạn |
| PV | Principal variation — chuỗi nước tốt nhất engine tìm được |
| MultiPV | Yêu cầu engine trả về nhiều biến cùng lúc (ở đây 3) |
| FEN | Chuỗi mô tả thế cờ (`... w - - 0 1`; `w` = Đỏ đi, `b` = Đen đi) |
| Centipawn (cp) | 1/100 quân Tốt; đơn vị điểm |
| COOP/COEP | Hai header bảo mật bật `SharedArrayBuffer` cho Stockfish |
