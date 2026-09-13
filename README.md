# 📱 GitHub Markdown Explorer

**GitHub Markdown Explorer** là ứng dụng Web Mobile-First tối ưu trải nghiệm duyệt, quản lý và đọc các tài liệu Markdown (`.md`) từ GitHub Repositories trực tiếp trên trình duyệt thiết bị di động và máy tính.

🌐 **Trải nghiệm ứng dụng ngay tại GitHub Pages**:  
👉 **[https://trungnguyenthien.github.io/GitHub-Markdown-Explorer/](https://trungnguyenthien.github.io/GitHub-Markdown-Explorer/)**

---

## 🌟 Tính Năng Nổi Bật

### 1. 📱 Thiết Kế Chuyên Biệt Cho Di Động (Mobile-First UI)
- Giao diện chuẩn **GitHub Primer Design System** sang trọng, mượt mà.
- Thanh điều hướng đáy cố định (**Fixed Bottom Navigation Bar**) với 5 Tab truy cập 1 chạm:
  - 📄 **Fav Page**: Danh sách các trang Markdown yêu thích & nút **Sync All** làm mới tất cả dữ liệu.
  - ⭐ **Fav Repo**: Truy cập nhanh các kho lưu trữ quan trọng đã đánh dấu sao.
  - 📁 **All Repo**: Khám phá toàn bộ repository với tính năng tự động ghim repo yêu thích lên đầu danh sách và ô tìm kiếm tức thì.
  - 🕒 **History**: Nhật ký lưu lại lịch sử các trang đã đọc (trang vừa đọc gần nhất nằm ở vị trí top).
  - 📖 **Reader**: Trình xem tài liệu Markdown toàn màn hình hỗ trợ chế độ xem Raw / Preview.

### 2. ⚡ Chế Độ Ngoại Tuyến & Lưu Cache (Offline Mode)
- Tự động lưu bản sao tài liệu yêu thích vào bộ nhớ local **IndexedDB** (`miniIdb`).
- Đọc tài liệu Markdown bình thường ngay cả khi không có kết nối Internet.

### 3. 📐 Hỗ Trợ Render Sơ Đồ Diagram Sinh Động
- Tự động nhận diện và render sơ đồ **Mermaid.js** (flowchart, sequence diagram, class diagram...).
- Render sơ đồ **PlantUML** dạng SVG mượt mà.
- Highlight cú pháp code block với **Highlight.js**.

### 4. 🔍 Tùy Chỉnh Phóng To / Thu Nhỏ Văn Bản (Zoom Scaling)
- Nút điều chỉnh kích thước chữ (**- / 100% / +**) áp dụng đồng bộ toàn bộ tài liệu Markdown (từ 75% đến 200%).

### 5. 🔒 An Toàn & Bảo Mật Tuyệt Đối (Zero-Backend)
- Chạy 100% Client-Side trực tiếp trên trình duyệt, không thông qua bất kỳ server trung gian nào.
- Sử dụng **GitHub Personal Access Token (PAT)** được lưu bảo mật trong `localStorage` trình duyệt của bạn.

---

## 🚀 Hướng Dẫn Sử Dụng Nhanh

1. Truy cập liên kết: **[https://trungnguyenthien.github.io/GitHub-Markdown-Explorer/](https://trungnguyenthien.github.io/GitHub-Markdown-Explorer/)**
2. Nhập mã **Personal Access Token (PAT)** cá nhân (cần quyền `repo` hoặc `public_repo`).
   - *Ứng dụng có sẵn nút Hướng dẫn từng bước cách tạo PAT GitHub.*
3. Chọn một kho lưu trữ để bắt đầu duyệt cây thư mục và đọc các tài liệu Markdown.
4. Bấm biểu tượng ngôi sao ⭐ trên tài liệu để đưa vào danh sách **Fav Page** & lưu cache đọc ngoại tuyến.

---

## 🔗 Liên Kết Dự Án

- **Repository**: [https://github.com/trungnguyenthien/GitHub-Markdown-Explorer](https://github.com/trungnguyenthien/GitHub-Markdown-Explorer)
- **Live Demo**: [https://trungnguyenthien.github.io/GitHub-Markdown-Explorer/](https://trungnguyenthien.github.io/GitHub-Markdown-Explorer/)

---
*Phát triển với ❤️ cho cộng đồng lập trình viên yêu thích Markdown trên di động.*
