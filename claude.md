# Cờ Tướng AI — hướng dẫn cho AI/lập trình viên

> **Bắt đầu từ [docs/FEATURES.md](docs/FEATURES.md)**: danh sách tính năng, cách chúng liên kết với nhau, luồng dữ liệu và bảng "đổi X thì xem Y".
> **Khi thêm/đổi/xóa tính năng, cập nhật `docs/FEATURES.md` cùng lúc** (`tests/docs.test.js` kiểm tra tài liệu không nhắc API đã mất).

Web app tĩnh (HTML/CSS/JS thuần, không build). Hướng dẫn đầy đủ: [docs/AI_GUIDELINES.md](docs/AI_GUIDELINES.md).

## Lệnh
- Chạy toàn bộ test: `npm test` (Node ≥ 20, không cần cài gói nào)
- Chạy một file: `node --test tests/xiangqi.test.js`
- Chạy app (dành cho người dùng tự xem; **AI không cần chạy** để kiểm tra): `python3 server.py` rồi mở http://localhost:8080 — server này gửi header COOP/COEP; **không dùng `http.server` thường**, nếu không engine Stockfish không chạy được (app tự rơi về engine nội bộ yếu hơn)
- Tạo lại icon (macOS): `swift scripts/make-icons.swift`

## Cấu trúc
| File | Vai trò | Phụ thuộc DOM |
|---|---|---|
| `js/xiangqi.js` | Luật cờ, FEN, UCI, ký hiệu Việt | Không |
| `js/engine.js` | Cầu nối tới Stockfish (`engine/`), engine alpha-beta nội bộ làm dự phòng, MultiPV, phân loại nước đi | Chỉ thanh trạng thái |
| `engine/` | **Stockfish/Fairy-Stockfish WASM (mã bên thứ ba, đừng sửa)**; chỉ `worker.js` là của dự án | Không |
| `js/main.js` | Bộ điều khiển ván cờ (`Game`) | Có |
| `js/geometry.js` | Toán hình học thuần cho việc vẽ (điểm đầu/đích của mũi tên) — **đặt logic vẽ cần test vào đây** | Không |
| `js/ui.js` | Vẽ bàn cờ, mũi tên các biến, panel | Có |
| `js/editor.js` | Chế độ phân tích thế cờ: xếp/sửa quân, nhiều biến + nước đối phương đáp lại | Có |
| `js/analyzer.js` | Phân tích cả ván | Có |
| `js/lessons.js` | Dữ liệu bài học (FEN) | Không |
| `js/pwa.js`, `sw.js`, `manifest.json` | Chạy offline / cài như app (PWA) | Có |

Thứ tự nạp script trong `index.html`: xiangqi → engine → geometry → ui → editor → analyzer → lessons → pwa → main.

## Quy tắc bắt buộc
1. **Tính năng mới hoặc sửa lỗi = có test mới.** Sửa lỗi: viết test tái hiện lỗi trước, thấy nó fail, rồi mới sửa.
2. **Trước khi sửa, kiểm tra tác động**: `grep` mọi nơi gọi hàm/trường dữ liệu sắp đổi (kể cả `index.html` `onclick`), liệt kê file bị ảnh hưởng.
3. **`npm test` phải xanh** trước khi báo xong. Không sửa/xóa test cho đến khi nó xanh trừ khi hành vi được yêu cầu đổi — và phải nói rõ.
4. **Thêm/đổi tên/xóa file tĩnh, hoặc sửa file đã cache → cập nhật `PRECACHE` trong `sw.js` và tăng `CACHE_VERSION`.** Nếu quên, người dùng đã cài app sẽ chạy bản cũ hoặc hỏng offline (`tests/pwa.test.js` bắt phần thiếu file).
5. **Chỉ cần unit test (`npm test`). KHÔNG mở trình duyệt, KHÔNG chạy server, KHÔNG test thủ công/E2E** để kiểm tra — tốn thời gian và không cần thiết. Logic phải đặt ở chỗ test được bằng Node (xem bên dưới).
6. Không tự bịa kết quả: chưa chạy `npm test` thì nói chưa chạy. Phần vẽ canvas/CSS không có unit test thì ghi một dòng "chưa kiểm tra bằng mắt" trong báo cáo, không cần làm gì thêm.

## Service worker & cập nhật (dễ gây lỗi "nút không chạy")
- Trang HTML và mọi file JS/CSS luôn lấy **từ cùng một cache cùng một phiên bản** (`sw.js`). Không đổi `navigate` thành network-first: HTML mới + JS cũ làm nút mới không chạy.
- Phiên bản mới được tải bằng `cache: 'reload'` (bỏ qua cache HTTP). Khi nó nhận quyền, `js/pwa.js` tự tải lại trang nếu không mất gì, nếu đang có ván/phân tích thì hiện banner `#update-banner` hỏi trước.
- Trên `localhost` service worker **không** được dùng (sửa code thấy ngay); thêm `?sw` vào URL để thử PWA cục bộ. Worker/cache cũ còn sót trên localhost sẽ tự bị xóa.
- Người dùng báo "tính năng không chạy / nút cũ vẫn hiện" mà test xanh → nghi ngờ **bản cũ trong cache**: xóa dữ liệu trang (Safari: Cài đặt → Safari → Nâng cao → Dữ liệu trang web; Chrome: DevTools → Application → Service Workers → Unregister) rồi tải lại.

## Engine & header bảo mật
- Stockfish cần `SharedArrayBuffer`, tức là trang phải được phục vụ với `Cross-Origin-Opener-Policy: same-origin` và `Cross-Origin-Embedder-Policy: require-corp`. File `_headers` (Netlify) và `server.py` (chạy local) đã cấu hình sẵn.
- Có COOP/COEP thì app dùng Stockfish; thiếu thì tự dùng engine nội bộ và thanh trạng thái ghi "Engine nội bộ (yếu hơn)".
- Tài nguyên cross-origin (Google Fonts) phải có header CORP; nếu thêm tài nguyên ngoài mới mà không hiện, kiểm tra COEP trước.
- Đăng lên Netlify: kéo cả `index.html`, `manifest.json`, `sw.js`, `_headers`, `css/`, `js/`, `engine/`, `icons/` (thiếu `_headers` hoặc `engine/` thì mất Stockfish).

## Quy ước dữ liệu (dễ sai nhất)
- Bàn cờ `board[row][col]`, 10 hàng × 9 cột. `row 0` = hàng cuối của Đen, `row 9` = hàng cuối của Đỏ. Chữ HOA = Đỏ, thường = Đen.
- UCI dùng hạng **1–10** (`h3e3`, `a10a9`); `XIANGQI.parseUCI` trả `null` nếu sai — luôn kiểm tra `null`.
- **Điểm engine = centipawn theo góc nhìn bên đang đi.** Chỉ `Engine.evalBoard` và `UI.updateEvalBar` dùng góc nhìn Đỏ. Đổi dấu ở đúng một chỗ (`analyzeLastMove`).
- Mũi tên gợi ý phải kết thúc **đúng tâm ô đích** (`Geometry.arrowPoints`) và được vẽ **sau** lớp quân; không rút ngắn đầu mũi tên theo bán kính quân (lỗi từng gặp: đầu mũi tên dừng sớm / bị quân che).
- **Huy hiệu đánh giá nước đi** (`!!`, `!`, `✓`, `–`, `?!`, `?`, `??`) hiện ở góc trên-phải quân vừa đi: dữ liệu `symbol`/`color` nằm trong `Engine.QUALITY` (màu phải khớp `--quality-*` trong CSS, có test), vị trí do `Geometry.badgePoint` tính (kẹp trong khung canvas), `UI.state.moveBadge` do `refreshMoveBadge()` trong `main.js` suy ra từ lịch sử (nước đang xem). Nước người đi được đánh giá, **kể cả trong chế độ phân tích** (cả hai bên); nước của máy thì không. `Engine.stopAnalysis()` chỉ ngắt phân tích nhiều biến (`analyzeMultiPV`), tuyệt đối không ngắt lượt đánh giá nước đi / nước của máy (có test với worker giả trong `tests/engine.worker.test.js`). Thêm chỗ nào thay đổi lịch sử/vị trí thì gọi `refreshMoveBadge()` hoặc đặt `UI.state.moveBadge = null`.
- **Menu chính** chọn chế độ (Người vs Máy / Người vs Người / Phân tích) hiện khi mở app và khi bấm chip ☰; chọn xong thì ẩn. **Chọn chế độ = reset bàn cờ** (`Game.setMode` luôn gọi `newGame`). Mức khó và màu quân chỉ là cài đặt (không reset ván đang chơi, có hiệu lực ở ván bắt đầu từ menu).
- **Độ khó & đa dạng nước đi của máy:** máy chọn có trọng số trong các nước chỉ kém nước tốt nhất một chút (`Engine.varietyForLevel` + `Engine.pickMove`) nên ván nào cũng khác. **Mức 10 phải luôn `margin 0` = nước chuẩn nhất**; mức càng thấp càng rộng; khai cuộc rộng hơn. Không bao giờ bỏ nước thắng cưỡng bức để đa dạng.
- **Nút Gợi ý** (dưới bàn cờ) chỉ có ở chế độ chơi với máy / người: gợi ý đúng **1 nước**, vẽ **1 mũi tên** (`UI.state.hintMove`), không vẽ chuỗi nước. Ở chế độ phân tích nút bị ẩn (`setMode`) và `requestHint()` không làm gì.
- Chế độ phân tích: gợi ý 3 biến có bộ lọc `Tắt / Cả hai / Chỉ Đỏ / Chỉ Đen` (`BoardEditor.setSuggestFilter`, lưu trong `localStorage`). Bên không nằm trong bộ lọc thì **không gọi engine**. Nút "Gợi ý" cũ bị ẩn và `requestHint()` không làm gì ở chế độ này.
- Giao diện mobile (≤768px): `.panel-left/.panel-right` dùng `display: contents` để sắp lại thứ tự bằng CSS `order` (bàn cờ ngay dưới ô chọn chế độ); `#main-analysis-card` là thanh gợi ý `position: fixed` ở đáy màn hình, thu gọn được. Trạng thái trang qua class trên `<body>`: `analysis-mode`, `sheet-collapsed`; chiều cao thanh qua biến CSS `--sheet-h` (đặt bằng `ResizeObserver`). Thêm khối cố định ở cuối trang phải tính tới thanh này.
- **Nút "Máy đi"** (`#btn-engine-move`) chỉ có ở chế độ phân tích: là **công tắc** (`Game.toggleEngineAutoPlay`), bật thì máy tự đi nước tốt nhất (không đa dạng) cho **bên đang tới lượt, cả hai bên**, liên tục tới hết ván; bấm lại (nhãn "Dừng máy") để tắt bất cứ lúc nào. Tự tắt khi hết ván, ván mới/đổi chế độ/`setPosition`/undo (mọi chỗ `gameId++`), hoặc vào xếp cờ. Kiểm tra `gameId` như mọi việc bất đồng bộ; nước của máy không có huy hiệu.
- Trên điện thoại, thanh gợi ý **luôn hiện nhưng nhỏ** (tối đa 25dvh, mỗi biến một dòng, không chú giải) để vừa xem gợi ý vừa đánh cờ; vẫn thu gọn tay được bằng thanh kéo, và tự thu gọn khi xếp cờ.
- Hết nước đi = **thua** (không phải hòa).
- **Xếp cờ (analysis mode → "Xếp cờ thế") là tự do hoàn toàn**: bấm bất kỳ quân nào (Đỏ hoặc Đen, không theo lượt) rồi bấm ô trống bất kỳ; đặt quân từ khay ở ô nào cũng được, kể cả sai luật hay xóa Tướng, **nhưng chỉ khi khay còn quân đó** (hết khay, vd đã đủ 5 Tốt, thì từ chối đặt quân thứ 6 và hiện toast; chỉ đếm quân trên bàn, chuyển quân không bị ảnh hưởng). **Không cảnh báo luật, không chấm gợi ý** khi đang xếp, và **không chạy engine**. Chỉ khi bấm "▶ Bắt đầu phân tích" mới gọi `validateBoard()` (Tướng/Sĩ trong cung, Tượng không qua sông, Tốt đúng chỗ, hai Tướng không đối mặt, đủ 2 Tướng, không quá số quân, bên không đi không bị chiếu) và liệt kê **toàn bộ** lỗi (`errors[]`) trong thông báo + khung tóm tắt; hết lỗi mới vào phân tích. Đừng thêm chặn/cảnh báo luật ở bước đặt quân (giới hạn khay là ngoại lệ duy nhất). Mọi thay đổi vị trí đi qua `Game.setPosition()`.
- Chế độ phân tích: mọi chỉnh sửa của trình xếp cờ phải đi qua `Game.setPosition()` (không sửa `gameState.board` trực tiếp) để lịch sử/undo không lệch.
- Điểm trong `Engine.analyzeMultiPV` là theo bên đang đi; thanh "Đánh giá" của editor đổi sang góc nhìn Đỏ bằng `redPov`.
- Mỗi lần phân tích thế cờ phải kiểm tra token (`isStale`) và dùng `shouldAbort`, để sửa nhanh liên tiếp không dồn việc cho engine.
- `gameState.board` luôn là thế cờ *thật*; khi xem lịch sử chỉ `UI.state.board` đổi (`viewIdx`).
- Mọi kết quả bất đồng bộ (AI, gợi ý, phân tích) phải kiểm tra `gameState.gameId` trước khi áp dụng.
