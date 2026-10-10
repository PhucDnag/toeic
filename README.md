# TOEIC AI Listening Assistant

Ứng dụng nghe và phân tích bài thi TOEIC Listening theo thời gian thực. Web hỗ trợ:

- Nghe văn bản thô và dùng AI tách từng câu theo nội dung, không bắt buộc đúng số câu hay nhãn A/B/C.
- Part 2: trả nội dung phản hồi phù hợp sau khi nghe đủ các phản hồi, không dựng bảng lựa chọn bằng biểu thức chính quy.
- Part 3 và Part 4: giữ nội dung hội thoại/bài nói làm ngữ cảnh cho từng nhóm ba câu và đưa ra gợi ý trả lời.
- Thu âm qua microphone hoặc lấy âm thanh trực tiếp từ tab trình duyệt.
- Chuyển giọng nói thành văn bản bằng Groq Whisper.
- Tự động chuyển sang Groq API key khác khi key hiện tại hết hạn mức hoặc không hợp lệ.

## Yêu cầu

- Node.js `20.9.0` trở lên.
- npm.
- Ít nhất một Groq API key.
- Chrome hoặc Edge để sử dụng microphone/chia sẻ âm thanh tab ổn định.

## Cài đặt

Mở Terminal hoặc PowerShell tại thư mục dự án:

```powershell
cd D:\Code\ai_toeic
npm install
```

## Cấu hình API key

Tạo file `.env.local` ở thư mục gốc của dự án. Cách đơn giản nhất:

```env
GROQ_API_KEY=gsk_your_primary_key
```

Để cấu hình nhiều key dự phòng, có thể dùng một dòng:

```env
GROQ_API_KEY=gsk_your_primary_key
GROQ_API_KEYS=gsk_your_second_key,gsk_your_third_key
```

Hoặc dùng các biến được đánh số:

```env
GROQ_API_KEY_1=gsk_your_first_key
GROQ_API_KEY_2=gsk_your_second_key
GROQ_API_KEY_3=gsk_your_third_key
```

Các cách trên có thể dùng chung. Dự án tự loại bỏ key trùng lặp. Khi Groq trả về lỗi hết hạn mức, giới hạn tốc độ hoặc xác thực, server sẽ thử key khả dụng tiếp theo.

Không đặt API key vào code phía client và không commit `.env.local` lên Git. File này đã được `.gitignore` bỏ qua.

Ứng dụng chỉ dùng Groq cho cả nhận dạng âm thanh và giải câu hỏi. Các key được luân phiên sử dụng; key bị giới hạn sẽ được tạm bỏ qua theo thời gian Groq yêu cầu. Giới hạn được theo dõi riêng cho từng model để việc giải câu không chặn Whisper. Nếu các key của model giải câu đều bận, ứng dụng thử model Groq khác; khi tất cả đều bận, đoạn nghe được giữ và tự thử lại sau thời gian chờ.

## Chạy ở chế độ phát triển

```powershell
npm run dev
```

Mở [http://localhost:3000](http://localhost:3000). Nếu cổng 3000 đang được sử dụng, Next.js sẽ hiển thị địa chỉ cổng khác trong Terminal.

Sau khi thay đổi `.env.local`, hãy dừng server bằng `Ctrl+C` rồi chạy lại `npm run dev` để cấu hình mới được nạp.

## Cách sử dụng

### Thu qua loa ngoài

1. Mở web và chọn **Bật Micro (Thu qua loa ngoài)**.
2. Cho phép trình duyệt truy cập microphone.
3. Phát bài nghe bằng loa và đặt microphone đủ gần nguồn âm thanh.
4. Không đổi thiết bị thu âm trong lúc web đang nghe. Nếu đổi thiết bị, hãy dừng rồi bật lại microphone.

### Lấy âm thanh trực tiếp từ tab

Đây là cách ổn định hơn nếu bài nghe đang phát từ YouTube hoặc một trang web khác:

1. Chọn **Chia sẻ âm thanh Tab / YouTube**.
2. Chọn đúng tab đang phát bài nghe.
3. Bật tùy chọn **Share tab audio/Chia sẻ âm thanh của thẻ** trong hộp thoại trình duyệt.
4. Không đóng tab hoặc dừng chia sẻ trong lúc làm bài.

Nếu không bật tùy chọn chia sẻ âm thanh, web sẽ không nhận được tiếng dù tab đã được chọn.

## Kiểm tra dự án

Kiểm thử audio tổng hợp 9 câu qua API Groq thật (Windows, có sử dụng hạn mức API): chạy server tại cổng 3211, tạo WAV bằng `powershell.exe -NoProfile -File tests/create-audio-smoke.ps1`, rồi chạy `node tests/manual-audio-smoke.cjs <đường-dẫn-WAV>`. Bài thử kiểm tra toàn luồng chia audio, nhận dạng, câu trả lời gián tiếp và lịch sử không bị lặp. Đây là audio tổng hợp, không đo chất lượng thu qua loa/microphone.

Chạy toàn bộ kiểm thử:

```powershell
node --test tests/*.test.cjs
```

Kiểm tra TypeScript:

```powershell
npx tsc --noEmit
```

Kiểm tra mã nguồn:

```powershell
npm run lint
```

Tạo production build:

```powershell
npm run build
```

## Chạy bản production

Build dự án trước, sau đó khởi động server:

```powershell
npm run build
npm run start
```

Mặc định ứng dụng chạy tại [http://localhost:3000](http://localhost:3000).

## Xử lý lỗi thường gặp

### Web báo chưa cấu hình API key

Kiểm tra `.env.local` nằm cùng cấp với `package.json`, tên biến viết đúng và key không bị đặt sau dấu `#`. Sau đó khởi động lại server.

### Microphone không hoạt động

Kiểm tra quyền microphone của trang trong Chrome/Edge, đúng thiết bị đầu vào của Windows và đóng các ứng dụng đang chiếm microphone nếu cần.

### Chia sẻ tab nhưng không có transcript

Chọn lại tab và nhớ bật **Share tab audio/Chia sẻ âm thanh của thẻ**. Chia sẻ toàn màn hình có thể không truyền âm thanh trên một số hệ thống; nên chia sẻ đúng tab phát audio.

### Groq trả lỗi giới hạn

Nếu đã cấu hình nhiều key, dự án sẽ tự chuyển key khi nhận lỗi giới hạn. Nếu tất cả key đều không khả dụng, cần chờ hạn mức được đặt lại hoặc sử dụng tài khoản/gói dịch vụ phù hợp. Nhiều key thuộc cùng một Groq organization vẫn có thể dùng chung hạn mức.

### Transcript nghe sai hoặc thiếu câu

Ưu tiên chia sẻ âm thanh tab. Khi dùng loa ngoài, giảm tiếng vang, tiếng quạt và đặt micro gần loa. Bấm **Reset Session** trước khi bắt đầu một đề mới để xóa trạng thái của đề trước.

## Cấu trúc chính

```text
src/app/                 Giao diện Next.js và API routes
src/app/api/transcribe/  Nhận dạng audio bằng Whisper
src/app/api/solve/       Phân tích và trả lời câu TOEIC
src/components/          Các thành phần giao diện
src/hooks/use-toeic.ts   Kết nối giao diện với luồng nghe
src/lib/audio-capture.ts Thu, chia đoạn và gửi audio
src/lib/raw-listening.ts Điều phối đoạn nghe thô, giữ phần chưa hoàn tất và lịch sử trả lời
tests/                   Kiểm thử luồng audio, câu hỏi và key pool
```

## Công nghệ

- Next.js 16
- React 19
- TypeScript
- Tailwind CSS 4
- Groq Whisper và Groq chat models
