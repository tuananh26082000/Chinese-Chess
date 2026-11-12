# Quy tắc khi dùng AI để phát triển dự án

Áp dụng cho Claude Code và mọi trợ lý AI khác, cũng như người review code do AI viết.
AI viết code nhanh nhưng hay "trông đúng mà sai" — các quy tắc dưới đây tồn tại để bắt lỗi sớm.

## 1. Quy trình cho mỗi thay đổi

1. **Hiểu yêu cầu và phạm vi.** Nêu lại ngắn gọn cái gì sẽ đổi và cái gì *không* đổi. Mơ hồ thì hỏi, đừng đoán.
2. **Đọc code liên quan trước khi viết.** Không sửa file chưa đọc. Không dựa vào trí nhớ về cấu trúc dự án.
3. **Kiểm tra tác động** (mục 3).
4. **Viết test trước hoặc cùng lúc** (mục 2).
5. **Cài đặt thay đổi nhỏ nhất đủ giải quyết vấn đề.** Không refactor "tiện tay" ngoài phạm vi.
6. **Chạy `npm test`.** Xanh thì mới tiếp.
7. **Báo cáo trung thực**: đã làm gì, `npm test` kết quả ra sao, phần nào (vẽ/CSS) không có unit test.

## 2. Test là bắt buộc

| Loại thay đổi | Phải có |
|---|---|
| Tính năng mới | Test cho hành vi chính **và** các trường hợp biên / đầu vào sai |
| Sửa lỗi | Test tái hiện lỗi, **chạy thấy fail trước khi sửa** (hồi quy) |
| Đổi luật cờ (`xiangqi.js`) | Thêm FEN cụ thể vào `tests/xiangqi.test.js`; perft phải giữ nguyên 44 / 1920 / 79666 trừ khi luật thật sự đổi |
| Đổi engine / chấm điểm | Test trong `tests/engine.test.js` kiểm tra **dấu** của điểm và nước đi hợp lệ |
| Đổi luồng ván (`main.js`) | Test trong `tests/game.test.js` (undo, điều hướng, AI, kết thúc ván) |
| Thêm/đổi file tĩnh (JS, CSS, icon) | Thêm vào `PRECACHE` trong `sw.js`, tăng `CACHE_VERSION`; `tests/pwa.test.js` phải xanh |
| Thêm bài học | FEN phải qua test "every lesson FEN is valid" |
| UI thuần (CSS/vẽ canvas) | **Không cần test**. Tách logic ra hàm thuần (tính vị trí, định dạng chuỗi, quyết định hiển thị gì) để unit test được; phần vẽ thì bỏ qua |

Quy tắc viết test:
- **Test phải có khả năng fail.** Cấm assertion luôn đúng (`|| true`, so sánh với chính nó). Sau khi viết, thử phá code một chút (đổi dấu, bỏ một điều kiện) và xác nhận test đỏ.
- Dùng FEN nhỏ, cụ thể, mỗi test một ý. Ghi chú vì sao thế cờ đó đúng.
- Đừng kiểm tra chi tiết cài đặt; kiểm tra hành vi quan sát được.
- Test không được phụ thuộc thời gian thực: dùng `waitFor(điều kiện)` thay cho `sleep` cố định.
- Không sửa test chỉ để cho nó xanh. Nếu test sai, giải thích vì sao; nếu code sai, sửa code.
- Test không dùng mạng và không cần cài thêm gói (`node:test` có sẵn).

### Phạm vi kiểm thử: chỉ unit test
- Dự án **chỉ yêu cầu unit test chạy bằng Node** (`npm test`, vài giây, không cần cài gì).
- **Không** mở trình duyệt, **không** dựng server, **không** chụp màn hình, **không** viết test E2E/Selenium/Playwright để xác nhận một thay đổi. Việc này chậm và không thuộc quy trình của dự án.
- DOM/`UI`/`document` trong test được giả lập bằng stub (xem `tests/helpers.js`, `tests/game.test.js`). Cần kiểm tra hành vi mới liên quan giao diện thì kiểm tra qua stub: trạng thái, lời gọi `UI.*`, nội dung gán vào phần tử.
- Muốn một thay đổi test được: đẩy logic ra khỏi code vẽ (hàm thuần trong `xiangqi.js`, `engine.js`, `editor.js`, `main.js`) rồi test hàm đó.
- Không có unit test cho phần vẽ canvas hoặc CSS là **chấp nhận được**; chỉ cần nói rõ trong báo cáo là phần đó chưa kiểm tra bằng mắt.

## 3. Kiểm tra tác động (impact check)

Trước khi đổi **tên, chữ ký, kiểu dữ liệu hoặc ý nghĩa** của thứ gì đó, làm theo thứ tự:

1. Tìm mọi nơi dùng: `grep -rn "tenHam" js index.html tests`. Nhớ `onclick="..."` trong `index.html` và code truy cập qua `window.game` / `window.analyzer`.
2. Liệt kê nơi dùng và quyết định cập nhật từng chỗ — ghi vào mô tả thay đổi.
3. Với giá trị trả về đổi dạng (ví dụ thêm `null`), kiểm tra **mọi** nơi gọi đã xử lý.
4. Với trạng thái dùng chung (`gameState`, `UI.state`, biến toàn cục trong engine), nghĩ xem luồng bất đồng bộ nào có thể chạy xen kẽ.
5. Chạy `npm test`, sau đó chạy lại ít nhất 2 lần để phát hiện test chập chờn.

### Bản đồ phụ thuộc (đọc trước khi sửa)
```
xiangqi.js  ←  engine.js  ←  main.js  →  ui.js
     ↑            ↑            ↑
     └────── analyzer.js ──────┘          lessons.js → main.js
```
- Đổi `xiangqi.js` ảnh hưởng **tất cả** — chạy toàn bộ test.
- Đổi dạng điểm / `analyzePosition` ảnh hưởng `main.js` (thanh eval, phân loại) và `analyzer.js`.
- Đổi cấu trúc `moveHistory` ảnh hưởng `ui.js` (`updateMoveHistory`), undo, điều hướng, thống kê cuối ván.
- Đổi id phần tử trong `index.html` ảnh hưởng `main.js` / `ui.js` (`getElementById`).

### Engine Stockfish (`engine/`)
- `engine/stockfish.*` là mã biên dịch của bên thứ ba: **không sửa, không format lại**. Chỉ `engine/worker.js` là của dự án (dùng đường dẫn tương đối, đừng hard-code `/engine/`).
- Stockfish/Fairy-Stockfish giấy phép **GPLv3**. Khi đăng app công khai cần tuân thủ (ghi nguồn, cung cấp mã nguồn tương ứng).
- Thiếu COOP/COEP thì engine không chạy nhưng app vẫn dùng được nhờ engine nội bộ — nên **mọi tính năng phải chạy được trên cả hai engine**, test chạy ở chế độ nội bộ.
- Thêm/đổi file trong `engine/` → cập nhật `PRECACHE` và tăng `CACHE_VERSION` (file wasm ~1,6 MB được cache để chơi offline).

### Offline / PWA
- Service worker chỉ chạy trên **HTTPS** (hoặc `localhost`). Qua `http://IP-LAN` thì `pwa.js` tự bỏ qua, app vẫn chạy nhưng không offline.
- Tài nguyên cache kiểu cache-first: sửa file mà **không tăng `CACHE_VERSION`** thì người đã cài vẫn thấy bản cũ.
- Tài nguyên ngoài (CDN engine, Google Fonts) không được precache; chỉ font được cache khi dùng lần đầu có mạng. Đừng thêm phụ thuộc mạng cho tính năng cốt lõi.
- Đổi icon: sửa `scripts/make-icons.swift`, chạy `swift scripts/make-icons.swift` (macOS), rồi tăng `CACHE_VERSION`.
- COEP `require-corp` chặn tài nguyên cross-origin không có header CORP. Thêm font/script/ảnh từ CDN khác thì phải kiểm tra trên trang thật.

### Những bẫy đã từng gây lỗi thật trong dự án này
- **Quên đổi góc nhìn điểm** (bên đi vs. Đỏ) → thanh eval và phân loại nước đi sai cho quân Đen.
- **Cộng nhiễu ngẫu nhiên vào điểm sau khi tìm kiếm alpha-beta** → engine bỏ qua nước chiếu hết.
- **Gọi engine song song** → promise treo. Mọi yêu cầu phải qua hàng đợi `enqueue`.
- **Áp kết quả async cũ** lên ván mới (AI, gợi ý, phân tích) → luôn so `gameId`.
- **Sửa bàn cờ thật khi đang xem lịch sử** → AI đi lên thế cờ sai. Giữ `gameState.board` là thế thật.
- **Hiểu sai luật**: hết nước đi là thua; tướng không được đối mặt; thế cờ FEN phải hợp lệ.
- **Cộng nhiễu ngẫu nhiên vào điểm sau khi tìm kiếm** là lỗi do chính thay đổi "cho AI đa dạng" gây ra (đã được test bắt trước khi bàn giao); muốn đa dạng thì xáo thứ tự nước đi, không đụng vào điểm.
- **Sửa bàn cờ trực tiếp từ module khác** (trình xếp cờ ban đầu làm thế) → lịch sử và undo lệch khỏi bàn cờ thật. Mọi thay đổi vị trí đi qua `Game.setPosition`.
- **Chạy phân tích mỗi lần bấm** (xếp cờ + tự động phân tích) → dồn hàng chục lần tìm kiếm 4 giây vào engine. Dùng debounce, token và `shouldAbort`.
- **Phiên bản lệch (HTML mới + JS cũ trong cache)**: unit test xanh nhưng người dùng thấy nút mới không chạy. Nguyên nhân từng gặp: trang tải từ mạng còn JS tải từ cache của service worker. Giữ trang và script cùng một cache; đổi `sw.js`/`pwa.js` phải chạy `tests/pwa.test.js`. Test dùng stub DOM **không bắt được** lỗi dây nối `index.html` ↔ JS và lỗi cache; khi người dùng báo "không chạy" mà test xanh, thử nghi ngờ cache trước khi nghi ngờ logic.
- **Đổi định dạng UCI** (hạng 10 là `10`, không phải `0`) → mất nước đi ở hàng cuối của Đen.

## 4. Khi làm việc với AI

**Nên**
- Giao việc rõ: mục tiêu, file liên quan, cái gì không được đụng, cách kiểm chứng ("`npm test` xanh").
- Yêu cầu AI nêu giả định và các file sẽ bị ảnh hưởng *trước* khi viết code với thay đổi lớn.
- Đọc diff. AI có thể sửa nhiều hơn yêu cầu; từ chối phần ngoài phạm vi.
- Cho AI chạy test và xem kết quả thật, không chấp nhận câu "chắc là chạy được".
- Review lại logic luật cờ và chấm điểm thủ công — đây là chỗ AI dễ sai tinh vi nhất.

**Không nên**
- Không tin con số/FEN/nước đi AI "nhớ" mà chưa chạy qua `parseFEN` hoặc test.
- Không để AI tắt/xóa/nới lỏng test để qua việc.
- Không dán bí mật (API key, token) vào prompt hoặc commit vào repo.
- Không thêm thư viện hoặc CDN mới mà không có lý do và không ghi lại (app hiện không có bước build).
- Không gộp nhiều việc không liên quan vào một thay đổi.

## 5. Checklist trước khi coi là xong

- [ ] Có test mới cho tính năng / lỗi, và đã thấy nó fail khi code bị phá
- [ ] `npm test` xanh, chạy ≥ 2 lần không chập chờn
- [ ] Đã `grep` mọi nơi dùng thứ bị đổi (gồm `index.html`)
- [ ] Đã cập nhật `docs/FEATURES.md` nếu đổi tính năng, luồng dữ liệu, trạng thái hoặc chế độ (và `tests/docs.test.js` xanh)
- [ ] Không còn `console.log` / code chết / file tạm
- [ ] Mô tả thay đổi nêu: đã đổi gì, ảnh hưởng gì, kiểm chứng thế nào, còn tồn đọng gì
- [ ] Nếu đổi quy ước dữ liệu → cập nhật `CLAUDE.md` và tài liệu này

## 6. Mẫu mô tả thay đổi

```
Mục đích:
Đã đổi: (file → thay đổi)
Tác động: (nơi gọi đã kiểm tra, module bị ảnh hưởng)
Test: (test mới + kết quả `npm test`)
Chưa kiểm tra bằng mắt: (phần vẽ/CSS nếu có đổi)
```
