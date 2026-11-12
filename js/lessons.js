/**
 * lessons.js - Learning content
 * Each lesson loads a FEN into the analysis board (fen: null = standard opening position).
 */

const LESSONS = [
  { icon: '♟', title: 'Các quân cờ & cách di chuyển', desc: 'Tìm hiểu cách di chuyển từng loại quân cờ trong cờ tướng.', difficulty: 'beginner', fen: null },
  { icon: '🏰', title: 'Sức mạnh của Xe', desc: 'Xe là quân mạnh nhất. Học cách sử dụng xe hiệu quả.', difficulty: 'beginner', fen: '4k4/9/9/9/9/9/9/R8/9/3K5 w - - 0 1' },
  { icon: '🐴', title: 'Nước Mã', desc: 'Mã đi theo hình chữ L và có thể bị chặn. Hiểu nguyên tắc này.', difficulty: 'beginner', fen: '4k4/9/9/9/9/9/4p4/4N4/9/3K5 w - - 0 1' },
  { icon: '💥', title: 'Chiến thuật Pháo', desc: 'Pháo cần nền để ăn quân. Học cách khai thác điều này.', difficulty: 'intermediate', fen: '3k5/9/9/4p4/9/9/9/4C4/9/4K4 w - - 0 1' },
  { icon: '🎯', title: 'Chiếu hết cơ bản', desc: 'Hai Xe chiếu hết theo hàng. Tìm nước chiếu hết trong 1 nước.', difficulty: 'intermediate', fen: '3k5/R8/9/9/9/9/9/9/9/4K3R w - - 0 1' },
  { icon: '⚔️', title: 'Tàn cục Xe vs Mã', desc: 'Nắm vững những nguyên tắc tàn cục quan trọng.', difficulty: 'intermediate', fen: '4k4/9/9/4n4/9/9/9/9/4R4/3K5 w - - 0 1' },
  { icon: '🏆', title: 'Chiến thuật nâng cao', desc: 'Các kế sách phức tạp: cưỡng bức, hy sinh, bẫy quân.', difficulty: 'advanced', fen: 'r1bakab1r/9/1cn1c1n2/p3p3p/2p3p2/2P6/P3P3P/1CN1C1N2/9/R1BAKAB1R w - - 0 1' },
  { icon: '🧠', title: 'Khai cuộc cổ điển', desc: 'Pháo đầu: nước khai cuộc phổ biến nhất. Đen cần đáp trả thế nào?', difficulty: 'advanced', fen: 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C2C4/9/RNBAKABNR b - - 0 1' },
];
