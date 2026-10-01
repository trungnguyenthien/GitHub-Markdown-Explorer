# 🔑 Hướng Dẫn Tạo GitHub Personal Access Token (PAT)

Để ứng dụng **GitHub Markdown Explorer** có thể kết nối với tài khoản GitHub của bạn (duyệt kho lưu trữ, đọc nội dung tài liệu Markdown và đồng bộ dữ liệu), bạn cần tạo một mã **Personal Access Token (PAT)**.

---

## 📋 Các Bước Tạo Token Chi Tiết

1. Đăng nhập vào tài khoản GitHub và truy cập trực tiếp trang tạo token:  
   👉 **[https://github.com/settings/tokens](https://github.com/settings/tokens)**  
   *(Hoặc vào **Settings** ➔ **Developer Settings** ở góc dưới cùng bên trái ➔ **Personal access tokens** ➔ **Tokens (classic)**)*.

2. Nhấn vào nút **Generate new token** (ở góc trên bên phải) ➔ chọn **Generate new token (classic)**.

3. Điền các thông tin thiết lập cho Token:
   - **Note (Tên gợi nhớ)**: Nhập tên để nhận biết (ví dụ: `GitHub Markdown Explorer`).
   - **Expiration (Thời hạn hiệu lực)**: Chọn thời hạn bạn mong muốn (khuyến nghị chọn *No expiration* để không bị gián đoạn khi sử dụng lâu dài).
   - **Select scopes (Chọn quyền truy cập)**: Tích chọn các quyền sau:
     - ✅ **`repo`** (*Full control of private repositories*): Cho phép ứng dụng đọc danh sách repository và tải nội dung file Markdown trong các kho lưu trữ của bạn (cả Public và Private).
     - ✅ **`gist`** (*Create gists*): Cho phép ứng dụng đồng bộ, sao lưu danh sách nhóm và trang yêu thích lên GitHub Gist cá nhân của bạn.

4. Cuộn xuống cuối trang và nhấn nút **Generate token** màu xanh lá.

5. **Sao chép mã Token** vừa tạo (dãy ký tự bắt đầu bằng tiền tố `ghp_...`) và dán vào ô nhập token trong ứng dụng.  
   > ⚠️ **Lưu ý quan trọng**: GitHub chỉ hiển thị mã token này **đúng 1 lần duy nhất** ngay sau khi tạo. Hãy sao chép ngay trước khi rời khỏi trang hoặc đóng trình duyệt.

---

## 🔒 Cam Kết Bảo Mật & Quyền Riêng Tư (Security & Privacy)

Chúng tôi cam kết tuyệt đối về tính an toàn và quyền riêng tư cho người dùng:

- 🛡️ **100% Lưu trữ cục bộ (Local Storage Only)**: Toàn bộ Token và dữ liệu bài viết của bạn **chỉ được lưu trữ duy nhất trên trình duyệt của thiết bị bạn đang dùng** (`localStorage`).
- ⚡ **Kiến trúc hoàn toàn không có máy chủ (Pure Client-Side PWA)**: Ứng dụng hoạt động 100% trên trình duyệt (static web app) được host trên GitHub Pages, hoàn toàn không có backend hay cơ sở dữ liệu trung gian nào. Mọi truy vấn API đều được trình duyệt của bạn gửi trực tiếp và duy nhất tới máy chủ chính thức của GitHub (`https://api.github.com`).
- 🚫 **Tuyệt đối không theo dõi hoặc thu thập dữ liệu**: Mã Token và tài liệu của bạn **không bao giờ** bị gửi tới bất kỳ bên thứ ba hay máy chủ ngoài nào khác.
- 🗑️ **Toàn quyền kiểm soát**: Bạn có thể xóa Token khỏi thiết bị bất kỳ lúc nào tại màn hình cài đặt trong ứng dụng, hoặc thu hồi quyền truy cập của Token trực tiếp trên trang quản lý GitHub Settings bất cứ khi nào bạn muốn.

---

[⬅️ Quay lại trang chính (README)](../README.md)
