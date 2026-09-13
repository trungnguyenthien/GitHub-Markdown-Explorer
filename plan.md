# Kế hoạch phát triển: GitHub Markdown Explorer (Công cụ Web Tĩnh)

## Phần 0: Tổng quan công cụ & Bối cảnh

**Vấn đề / Động lực**: Trung thường xuyên cần xem tài liệu markdown (tài liệu kỹ thuật, ghi chú, sơ đồ) được lưu trữ trên nhiều kho lưu trữ (repository) GitHub khác nhau. Tuy nhiên, thao tác này qua giao diện web của GitHub rất chậm — việc chuyển hướng giữa các thư mục, mở file thô (raw file), cũng như các sơ đồ PlantUML/Mermaid bên trong các file `.md` không được hiển thị (render) trong giao diện xem trước mặc định của GitHub cho các repo riêng tư (private) hoặc trong một số bối cảnh nhất định. Đồng thời, cũng không có cách nào nhẹ nhàng để đánh dấu (bookmark), tùy chỉnh kích thước chữ hiển thị và đọc lại offline các file thường xuyên truy cập khi không có kết nối mạng ổn định. Ngoài ra, việc người dùng mới tạo mã PAT (Personal Access Token) đúng quyền truy cập đôi khi mất thời gian tìm kiếm nếu không có hướng dẫn tích hợp sẵn.

**Đối tượng người dùng mục tiêu**: Một người dùng kỹ thuật cá nhân (Trung) sử dụng Mã thông báo truy cập cá nhân (Personal Access Token - PAT) GitHub của chính mình, xem đây là một công cụ nâng cao năng suất cá nhân — không phải là một sản phẩm công cộng dành cho nhiều người dùng. Người dùng thoải mái trong việc tạo và dán mã PAT.

**Giá trị cốt lõi / Mục tiêu**: Công cụ này cho phép người dùng duyệt qua bất kỳ repo GitHub nào họ có quyền truy cập, đọc các file markdown với giao diện chuẩn **GitHub Native UI (Primer)**, hiển thị đầy đủ các sơ đồ PlantUML/Mermaid đã được render, tự động lưu cache offline cho các tài liệu yêu thích để đọc lại ngay lập tức khi không có mạng, tùy chỉnh thu phóng kích thước chữ (Zoom In/Out) áp dụng toàn cục cho tất cả tài liệu, tích hợp sẵn **Trang hướng dẫn tạo PAT & hướng dẫn sử dụng nhanh**, và đồng bộ (sync) cập nhật mới nhất từ GitHub chỉ với 1 cú nhấp chuột — tất cả chỉ từ một trang HTML tĩnh duy nhất mà không cần bất kỳ backend nào.

**Kịch bản sử dụng chính (Luồng chính)**: 
1. Người dùng mở trang web (giao diện mang phong cách GitHub.com).
2. Nếu chưa có mã PAT: Nhấp đường dẫn *"Hướng dẫn tạo PAT"* ngay tại thẻ kết nối để xem các bước tạo token trực quan kèm liên kết tự động điền sẵn tham số tạo token của GitHub → dán mã PAT một lần (được lưu vào localStorage) → thấy danh sách các repo của mình.
3. Đánh dấu sao một vài repo và file làm yêu thích → ứng dụng **tự động lưu cache offline** nội dung các file yêu thích vào IndexedDB.
4. Người dùng có thể tùy chỉnh phóng to/thu nhỏ kích thước chữ hiển thị (từ 75% đến 200%) tùy theo màn hình và nhu cầu đọc — mức zoom này tự động lưu và áp dụng toàn cục cho mọi trang `.md`.
5. Khi cần trợ giúp sử dụng các tính năng: Nhấp biểu tượng Trợ giúp `?` trên thanh Header để mở Hướng dẫn sử dụng nhanh.
6. Khi ngắt kết nối mạng hoặc truy cập lại sau đó → người dùng vẫn có thể xem tức thì các file yêu thích từ Cache offline với giao diện chuẩn Markdown của GitHub.
7. Khi có mạng trở lại → bấm nút **"Đồng bộ tất cả" (Sync All)** hoặc mở từng file để tự động kiểm tra và cập nhật nội dung mới nhất từ GitHub.

**Phạm vi ranh giới (Scope boundaries)**:

- Không sử dụng luồng OAuth — chỉ dùng PAT.
- Không chỉnh sửa / ghi ngược lại GitHub (chỉ đọc - read-only).
- Không hỗ trợ render các file không phải markdown (các file mã nguồn, hình ảnh chỉ hiển thị dạng liên kết nguyên bản, không xem trước).
- Không hỗ trợ nhiều người dùng, không chia sẻ danh sách yêu thích giữa các thiết bị (localStorage/IndexedDB hoạt động theo từng trình duyệt).
- Không xem lịch sử commit / diff.
- **Có hỗ trợ giao diện chuẩn GitHub (GitHub Primer Design System)**: Tái tạo chính xác trải nghiệm hình ảnh, màu sắc, font chữ và phong cách hiển thị tài liệu của GitHub.com.
- **Có hỗ trợ Trang hướng dẫn tích hợp (Integrated User & PAT Guide)**: Cung cấp tài liệu hướng dẫn tạo PAT từng bước và hướng dẫn sử dụng tính năng trực tiếp trong ứng dụng.
- **Có hỗ trợ lưu trữ offline & đồng bộ (Offline Cache & Sync)**: Áp dụng cho các file `.md` đã được đánh dấu yêu thích (Favorites) thông qua `IndexedDB` (vẫn đảm bảo 100% web tĩnh, không backend).
- **Có hỗ trợ Thu phóng toàn cục (Global Document Zoom)**: Tùy chỉnh mức phóng to/thu nhỏ chữ cho các trang markdown và lưu trạng thái vào `localStorage`.

**Tiêu chí thành công**:

- Giao diện người dùng mang đậm phong cách GitHub (Header màu tối, các khung viền bo tròn 6px, bộ biểu tượng Octicons, bảng màu Primer).
- Hướng dẫn tạo PAT dễ hiểu, người dùng chỉ cần nhấp liên kết tích hợp sẵn là có thể tạo được token với đầy đủ quyền phù hợp.
- Danh sách repo và cây thư mục file tải trong khoảng ~1–2 giây sau khi nhập PAT (phụ thuộc vào mạng).
- File Markdown được render đúng 100% chuẩn định dạng GFM (GitHub Flavored Markdown) thông qua `github-markdown-css`.
- Các khối mã PlantUML và Mermaid bên trong markdown được render thành sơ đồ trực quan, không phải văn bản thô.
- Các mục yêu thích (repo và file) được lưu trữ qua các phiên làm việc của trình duyệt bằng localStorage và vẫn tồn tại sau khi tải lại trang (reload).
- **Mở tức thì (<100ms)** các file tài liệu yêu thích từ Cache Offline khi không có kết nối mạng.
- Mức thu phóng tài liệu (Zoom level) hoạt động mượt mà, áp dụng chính xác cho tất cả nội dung `.md` và duy trì qua các lần đổi file cũng như tải lại trang.
- Đồng bộ hóa mượt mà bản mới nhất từ GitHub khi có mạng mà không làm mất trạng thái xem hiện tại.

---

## Phần 1: Giao diện Web (GitHub Primer Design System)

**Hệ thống thiết kế (Design system)**: GitHub Primer Design System — giao diện tinh tế chuẩn GitHub.com với viền mảnh 1px (`border: 1px solid var(--color-border-default)`), bo góc thẻ 6px (`border-radius: 6px`), thanh tiêu đề màu tối `#24292f`, tab điều hướng kiểu GitHub Subnav/UnderlineNav, và hiệu ứng tương tác nguyệt sắc (subtle hover state).

**Bảng màu (GitHub Primer Tokens)**:

- Header App Bar: `#24292F` (xám đen GitHub Header)
- Nền chính (Canvas Default): `#FFFFFF` (Sáng) / `#0D1117` (Tối)
- Nền phụ (Canvas Inset/Subtle): `#F6F8FA` (Sáng) / `#161B22` (Tối)
- Viền (Border Default): `#D0D7DE` (Sáng) / `#30363D` (Tối)
- Chữ chính (Text Primary): `#1F2328` (Sáng) / `#E6EDF3` (Tối)
- Liên kết / Nhấn (Link / Accent): `#0969DA` (Sáng) / `#58A6FF` (Tối)
- Sao yêu thích (Star / Favorite): `#E3B341` (Vàng kim đặc trưng GitHub Star)
- Màu trạng thái Sync & Offline: 
  - Đã đồng bộ (Success): `#1A7F37` (Xanh lá GitHub)
  - Đang đồng bộ (Attention): `#0969DA` (Xanh dương GitHub)
  - Chế độ Offline / Bản Cache (Muted): `#57606A` (Xám tro GitHub)

**Kiểu chữ (Typography) & Quy tắc Thu phóng (Zoom Rule)**:
- Bộ font chuẩn hệ thống của GitHub: `-apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji"` cho giao diện ứng dụng.
- Font mã nguồn chuẩn của GitHub: `ui-monospace, SFMono-Regular, SF Mono, Menlo, Consolas, Liberation Mono, monospace` (cho các khối code).
- Phân cấp font: H1 1.5rem (bold, có gạch chân viền 1px kiểu GitHub), H2 1.25rem, body 0.95rem, caption 0.8rem.
- **Biến CSS Thu phóng toàn cục**: Định nghĩa biến `--md-content-scale: 1.0` trên khung chứa lớp `markdown-body` (GitHub Markdown CSS).
  Cấu trúc CSS thu phóng:
  ```css
  .markdown-body {
    font-size: calc(16px * var(--md-content-scale, 1)) !important;
  }
  .markdown-body h1 { font-size: calc(2em * var(--md-content-scale, 1)) !important; }
  .markdown-body h2 { font-size: calc(1.5em * var(--md-content-scale, 1)) !important; }
  .markdown-body pre, .markdown-body code { font-size: calc(85% * var(--md-content-scale, 1)) !important; }
  .markdown-body .mermaid svg, .markdown-body img { transform-origin: top left; scale: var(--md-content-scale, 1); }
  ```

**Bộ biểu tượng (Iconography)**: Sử dụng hệ thống biểu tượng **Octicons SVG** chính thức của GitHub (Repo Icon, Folder Icon, File Markdown Icon 📄, Star Icon ⭐, Sync Icon 🔄, Settings Icon ⚙️, Question Mark Icon ❓, Search Icon 🔍).

**Bố cục (Layout)**: Mobile-first, hai cột trên Desktop giống giao diện khám phá của GitHub.

- Điểm ngắt (Breakpoints): <600px (di động, xếp chồng, thanh điều hướng bottom nav kiểu GitHub), 600–1024px (máy tính bảng, sidebar có thể thu gọn), >1024px (máy tính bàn, sidebar 290px bo viền + vùng xem nội dung chính kiểu GitHub Box).
- Thanh ứng dụng trên cùng (GitHub Header Bar): Cố định, màu `#24292f`, chứa logo GitHub SVG, tiêu đề "GitHub Markdown Explorer", thanh trạng thái kết nối PAT, chỉ báo mạng (Online/Offline) dạng Badge Primer, **Nút Trợ giúp `?` (Octicon Question)**, và nút Cài đặt.
- Thanh bên (Desktop / Subnav): Gồm ô tìm kiếm kiểu GitHub (`input.form-control`) và các Tab phân loại kiểu `UnderlineNav` ("Repositories", "Favorite Repos", "Favorite Files").

**Các màn hình / phần chính**:

1. **Thẻ nhập PAT (PAT Entry Card)** — khung thiết kế dạng GitHub Box (`Box-header`, `Box-body`); trường nhập liệu mật khẩu + nút bấm chuẩn GitHub `btn-primary` ("Connect") + **Đường dẫn trợ giúp "How to generate a Personal Access Token?"** liên kết trực tiếp mở Hộp thoại Hướng dẫn.
2. **Thanh ứng dụng (GitHub Header Bar)** — logo GitHub, tiêu đề, thẻ kết nối, nút Trợ giúp `?`, nút Cài đặt/Đăng xuất.
3. **Điều hướng thanh bên (Sidebar Navigation)** — danh sách Repos / Favorites được thiết kế dạng `ActionList` của GitHub với các biểu tượng Octicon bên trái.
4. **Chế độ xem danh sách Repo (Repo List View)** — mỗi repo một ô dạng `Box-row` (tên kho lưu trữ màu xanh `#0969DA`, nhãn Public/Private badge, mô tả, nút sao Octicon Star, lần cập nhật cuối).
5. **Bảng cây thư mục file (File Tree Panel)** — đường dẫn breadcrumb dạng GitHub Header Path + cây thư mục dạng `FileTree` (thư mục màu xanh dương, file `.md` có logo Markdown Octicon).
6. **Bảng xem Markdown (Markdown Viewer Panel)** — hiển thị trong khung `Box` của GitHub. Header của Box dạng `Box-header` chứa:
   - Tên file kèm Octicon File.
   - Nút Đánh dấu Sao (Star/Unstar).
   - Nút bật/tắt "Raw".
   - **Cụm nút Thu phóng Zoom**: Nút Zoom Out (`-`), Thẻ hiển thị tỷ lệ (`100%`), Nút Zoom In (`+`).
   - **Nút "Sync Now"** (Octicon Sync) và **Huy hiệu trạng thái Sync** (🟢 Synced, 🟡 Syncing..., ⚪ Offline Cache).
   - Nút **"View on GitHub"** mở trực tiếp link file trên GitHub.com trong tab mới.
7. **Khung nội dung Markdown (`.markdown-body`)**: Áp dụng thư viện `github-markdown-css` để render văn bản, bảng biểu, blockquote, danh sách kiểm tra (checkboxes) đúng chuẩn 100% giao diện GitHub.
8. **Chế độ xem yêu thích (Favorites View)** — hai danh sách trong khung `Box` với nút **"Sync All Favorites"** ở đầu trang.
9. **Hộp thoại Hướng dẫn sử dụng & Tạo PAT (User Guide & PAT Creation Modal)** — Thiết kế dạng GitHub Primer Modal gồm `Box-header` với `UnderlineNav` phân thành 2 tab:
   - **Tab 1: PAT Creation Guide**:
     - Nút hành động nhanh "Create PAT on GitHub" mở trực tiếp URL: `https://github.com/settings/tokens/new?scopes=repo&description=GitHub-Markdown-Explorer`.
     - Các bước minh họa ngắn gọn: Chọn quyền `repo` (hoặc `public_repo`), chọn ngày hết hạn, bấm Generate token.
     - Khẳng định an toàn bảo mật: Token chỉ được lưu ở `localStorage` của trình duyệt người dùng, không bao giờ gửi ra máy chủ ngoài.
   - **Tab 2: App Feature Guide**:
     - Hướng dẫn nhanh cách duyệt cây file, đánh dấu sao yêu thích, cách hoạt động của Cache Offline không cần mạng, cách đồng bộ lại và thu phóng tài liệu.
10. **Thông báo Toast/Flash** — thiết kế dạng `FlashAlert` của GitHub (`Flash--success`, `Flash--error`, `Flash--warning`).

---

## Phần 2: Các thư viện hỗ trợ & Web APIs

| Thư viện / Web API     | Mục đích                                          | Lý do chọn                                                                     | Cú pháp CDN / Nguồn gốc                                         |
| ---------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------ | --------------------------------------------------------------- |
| **github-markdown-css**| CSS render chuẩn 100% giao diện Markdown của GitHub | Chuẩn chính thức từ GitHub, tự động định dạng bảng, code block, quote, checklist | `https://cdn.jsdelivr.net/npm/github-markdown-css@5/github-markdown.min.css` |
| **marked.js**          | Phân tích (parse) markdown (GFM) sang HTML        | Phổ biến nhất, nhẹ, API đơn giản, hỗ trợ GFM tốt                               | `https://cdn.jsdelivr.net/npm/marked/marked.min.js`             |
| **DOMPurify**          | Làm sạch (sanitize) HTML đã render trước khi chèn vào DOM | Markdown → innerHTML có nguy cơ XSS do nội dung repo không đáng tin cậy; bắt buộc | `https://cdn.jsdelivr.net/npm/dompurify/dist/purify.min.js`     |
| **Mermaid.js**         | Render các khối code `mermaid` thành sơ đồ        | Chính thức, tiêu chuẩn thực tế cho Mermaid, chạy thuần phía client             | `https://cdn.jsdelivr.net/npm/mermaid/dist/mermaid.esm.min.mjs` |
| **highlight.js**       | Nổi bật cú pháp (syntax highlighting) cho các khối code khác | Tiêu chuẩn, hỗ trợ theme `github.min.css` khớp hoàn toàn phong cách GitHub     | `https://cdn.jsdelivr.net/npm/highlight.js/styles/github.min.css` & `lib/core.min.js` |
| **idb-keyval**         | Lưu trữ và quản lý Offline Cache trong IndexedDB  | Thư viện cực nhẹ (~600B), đống đóng gói Key-Value đơn giản trên IndexedDB, vượt giới hạn 5MB của localStorage | `https://cdn.jsdelivr.net/npm/idb-keyval@6/dist/umd/use-idb-keyval.min.js` |

**Render PlantUML — không cần thư viện JS riêng cho bản thân sơ đồ.** Vì không có backend, văn bản PlantUML không thể render cục bộ (yêu cầu máy chủ dựa trên Java/Graphviz). Phương pháp: mã hóa nguồn PlantUML bằng thuật toán mã hóa văn bản chuẩn của PlantUML (deflate + base64 tùy chỉnh) và yêu cầu SVG đã render từ máy chủ PlantUML công cộng (`https://www.plantuml.com/plantuml/svg/{encoded}`) thông qua thẻ `<img>`. Đây là endpoint hình ảnh công cộng chỉ đọc, không phải máy chủ do bạn tự host — phù hợp với tiêu chí "không backend".

| Thư viện | Mục đích                                                                                            | Lý do chọn                                                | Cú pháp CDN                                          |
| -------- | --------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | ---------------------------------------------------- |
| **pako** | Nén Deflate (raw deflate) theo yêu cầu của cơ chế mã hóa PlantUML trước khi tạo URL               | Tiêu chuẩn, nhỏ gọn, giải pháp duy nhất để deflate trong trình duyệt | `https://cdn.jsdelivr.net/npm/pako/dist/pako.min.js` |

Truy cập GitHub API: dùng `fetch()` thuần, không cần thư viện SDK — GitHub REST API là JSON thuần trên HTTPS.

---

## Phần 3: Logic Hành động / Tương tác

### Mô hình Trạng thái Tổng thể (Overall State Model)

Đối tượng trạng thái trong bộ nhớ:

```js
const appState = {
  token: null, // Chuỗi PAT, đồng bộ với localStorage
  repos: [], // Danh sách repo đã lấy cho người dùng đã xác thực
  currentRepo: null, // { owner, name, defaultBranch }
  currentPath: [], // Các phân đoạn đường dẫn breadcrumb trong repo hiện tại
  currentTreeEntries: [], // Danh sách file/thư mục tại currentPath
  currentFileContent: null, // Chuỗi markdown thô của file đang mở
  favoriteRepos: [], // [{owner, name}]
  favoriteFiles: [], // [{owner, name, path}]
  view: "repos", // 'repos' | 'favorites' | 'viewer'
  isOffline: !navigator.onLine, // Trạng thái kết nối mạng hiện tại
  fontScale: parseInt(localStorage.getItem('gh_font_scale') || '100', 10), // Tỷ lệ zoom (75 - 200, mặc định 100)
  isGuideOpen: false, // Trạng thái mở/đóng Modal Hướng dẫn
  activeGuideTab: "pat", // Tab hướng dẫn đang chọn ('pat' | 'features')
  syncStatus: {
    // [fileKey]: { status: 'synced'|'syncing'|'cached'|'error', lastSyncedAt: timestamp, sha: string }
  }
};
```

Cấu trúc đối tượng Cache Offline trong **IndexedDB** (`storeName: 'favorite_md_cache'`):
Key: `${owner}/${name}/${path}`
Value:
```js
{
  fileKey: "owner/repo/path/to/file.md",
  owner: "owner",
  name: "repo",
  path: "path/to/file.md",
  content: "# Raw markdown content...",
  sha: "b5c6d7e...", // Git commit blob SHA để so sánh thay đổi
  lastSyncedAt: 1726218000000 // Timestamp Unix (ms)
}
```

Các khóa localStorage: `gh_pat_token`, `gh_favorite_repos`, `gh_favorite_files`, `gh_font_scale`.

**Tóm tắt luồng dữ liệu (Data flow summary)**: Hành động người dùng kích hoạt lệnh fetch đến GitHub API → kết quả cập nhật vào `appState` → một bộ điều phối `renderApp()` duy nhất render lại phần giao diện đang hoạt động dựa trên `appState.view`, đọc trực tiếp từ trạng thái thay vì tải lại. Các thao tác bật/tắt yêu thích ghi trực tiếp vào `appState` + localStorage, đồng thời kích hoạt lưu/xóa Cache trong IndexedDB. Mức thu phóng `fontScale` cập nhật biến CSS và tự động duy trì qua `localStorage`. Giao diện tự động khoác lớp áo GitHub Primer. Cờ `isGuideOpen` điều khiển hiển thị Modal Hướng dẫn.

---

### 1. Nhập PAT / Kết nối

- **Kích hoạt (Trigger)**: Nhấp nút "Kết nối" (`btn-primary`) trên thẻ nhập PAT, hoặc nhấn phím `Enter` trong ô nhập token.
- **Tên hàm (Function name)**: `connectWithToken()`
- **Logic từng bước**:
  1. Đọc giá trị token từ trường nhập liệu, cắt bỏ khoảng trắng thừa (trim).
  2. Nếu rỗng, hiển thị lỗi trực tiếp "Bắt buộc nhập Token", hủy thao tác.
  3. Gọi GitHub API `GET /user` với header `Authorization: Bearer {token}` để xác thực token.
  4. Nếu phản hồi là 200, lưu token vào `appState.token` và `localStorage.gh_pat_token`.
  5. Ẩn thẻ nhập PAT, hiển thị khung ứng dụng chính.
  6. Gọi `loadRepos()`.
  7. Nếu phản hồi là 401, hiển thị Flash alert lỗi "Token không hợp lệ" và giữ nguyên thẻ nhập PAT.
- **Trạng thái bị ảnh hưởng (State touched)**: `appState.token`; localStorage `gh_pat_token`.
- **Trường hợp biên & Xử lý lỗi**: Lỗi mạng → flash alert "Lỗi kết nối mạng, vui lòng kiểm tra kết nối"; token bị giới hạn lượt gọi (rate-limited) → flash alert kèm thời gian reset lấy từ header `X-RateLimit-Reset`.
- **Cập nhật DOM**: Đổi trạng thái hiển thị giữa `#patEntryCard` và `#appShell`; cập nhật thẻ trạng thái kết nối trên app bar thành "Connected".

### 2. Tải danh sách Repo

- **Kích hoạt**: Tự động sau khi kết nối thành công, hoặc nhấp vào tab "Repositories".
- **Tên hàm**: `loadRepos()`
- **Logic từng bước**:
  1. Gọi `GET /user/repos?sort=updated&per_page=50` (phân trang bằng tham số `page` khi cuộn).
  2. Ánh xạ phản hồi thành các đối tượng `{owner, name, description, updatedAt, isPrivate}`.
  3. Lưu vào `appState.repos`.
  4. Đối chiếu với `appState.favoriteRepos` để đánh dấu cờ `isFavorite` cho từng repo.
  5. Gọi `renderRepoList()`.
- **Trạng thái bị ảnh hưởng**: `appState.repos` (đọc từ GitHub API, không lưu bền vững).
- **Trường hợp biên & Xử lý lỗi**: Danh sách repo rỗng → hiển thị trạng thái rỗng chuẩn GitHub (`blankslate`) + văn bản "No repositories found"; Lỗi API → Flash alert + nút thử lại.
- **Cập nhật DOM**: Chèn các phần tử hàng `Box-row` repo vào `#repoListContainer`.

### 3. Bật/Tắt Repo Yêu thích

- **Kích hoạt**: Nhấp vào biểu tượng Octicon Star trên thẻ repo (trong danh sách repo hoặc chế độ xem yêu thích).
- **Tên hàm**: `toggleFavoriteRepo(owner, name)`
- **Logic từng bước**:
  1. Kiểm tra xem `{owner, name}` có tồn tại trong `appState.favoriteRepos` hay không.
  2. Nếu có thì xóa; nếu chưa có thì thêm vào.
  3. Lưu mảng cập nhật vào `localStorage.gh_favorite_repos` (JSON.stringify).
  4. Cập nhật trạng thái biểu tượng sao của thẻ cụ thể (tô màu vàng kim `#E3B341` / viền nét) mà không cần render lại toàn bộ.
  5. Nếu đang ở chế độ xem Favorites, render lại danh sách đó.
- **Trạng thái bị ảnh hưởng**: `appState.favoriteRepos`; localStorage `gh_favorite_repos`.
- **Trường hợp biên & Xử lý lỗi**: Lỗi ghi localStorage (vượt dung lượng) → Flash alert "Could not save favorite".
- **Cập nhật DOM**: Chuyển đổi class trên biểu tượng Octicon Star; render lại danh sách yêu thích nếu đang hoạt động.

### 4. Mở Repo / Duyệt cây thư mục File

- **Kích hoạt**: Nhấp vào một thẻ repo.
- **Tên hàm**: `openRepo(owner, name)`
- **Logic từng bước**:
  1. Đặt `appState.currentRepo = {owner, name}`, `appState.currentPath = []`.
  2. Lấy nhánh mặc định qua `GET /repos/{owner}/{name}` (lấy `default_branch`).
  3. Lấy cây thư mục gốc qua `GET /repos/{owner}/{name}/git/trees/{default_branch}?recursive=1`.
  4. Lọc/tổ chức các mục thành cấu trúc phân cấp lồng nhau theo đường dẫn.
  5. Lưu vào `appState.currentTreeEntries`.
  6. Chuyển chế độ xem sang bảng cây thư mục file, gọi `renderFileTree()`.
- **Trạng thái bị ảnh hưởng**: `appState.currentRepo`, `appState.currentTreeEntries`.
- **Trường hợp biên & Xử lý lỗi**: Repo rỗng (chưa có commit) → hiển thị `blankslate` "This repository is empty"; Repo lớn (cờ `truncated: true`) → Flash alert cảnh báo "Showing partial file list (repo too large)".
- **Cập nhật DOM**: Render thanh breadcrumb + cây thư mục trong khung `#fileTreeContainer`; các file markdown được gắn biểu tượng Octicon File Markdown màu xanh.

### 5. Điều hướng Thư mục

- **Kích hoạt**: Nhấp vào một hàng thư mục trong cây thư mục.
- **Tên hàm**: `navigateFolder(path)`
- **Logic từng bước**:
  1. Thêm phân đoạn `path` vào `appState.currentPath`.
  2. Lọc `appState.currentTreeEntries` (đã lấy đệ quy trước đó) để lấy các mục khớp với tiền tố đường dẫn hiện tại, sâu 1 cấp.
  3. Render lại cây thư mục và breadcrumb.
- **Trạng thái bị ảnh hưởng**: `appState.currentPath`.
- **Trường hợp biên & Xử lý lỗi**: Không có (dữ liệu đã có sẵn trong bộ nhớ từ đợt lấy đệ quy).
- **Cập nhật DOM**: Cập nhật thanh `#breadcrumb`, render lại `#fileTreeContainer`.

### 6. Mở File Markdown (Chiến lược Stale-While-Revalidate & Fallback Cache)

- **Kích hoạt**: Nhấp vào một hàng file `.md` trong cây thư mục, hoặc nhấp vào một thẻ file yêu thích.
- **Tên hàm**: `openMarkdownFile(owner, name, path)`
- **Logic từng bước**:
  1. Tạo `fileKey = `${owner}/${name}/${path}``.
  2. Kiểm tra bản ghi trong IndexedDB qua `idbKeyval.get(fileKey)`.
  3. **Nếu có trong Cache**:
     - Hiển thị ngay nội dung từ Cache lên màn hình viewer (`renderMarkdown(cachedData.content)`).
     - Áp dụng ngay mức zoom `applyFontScale(appState.fontScale)`.
     - Cập nhật huy hiệu trạng thái thành: `⚪ Offline Cache` nếu không có mạng, hoặc `🟢 Synced ({thời gian})` nếu vừa mới sync.
  4. **Nếu không có mạng (`appState.isOffline` hoặc `fetch` thất bại)**:
     - Nếu đã hiển thị từ Cache: Giữ nguyên giao diện, thông báo Flash alert nhẹ "Viewing cached offline version".
     - Nếu không có trong Cache: Hiển thị giao diện `blankslate` lỗi "Cannot load file offline".
  5. **Nếu có mạng (`navigator.onLine`)**:
     - Cập nhật huy hiệu trạng thái thành `🟡 Checking for updates...`.
     - Gọi GitHub API `GET /repos/{owner}/{name}/contents/{path}`.
     - Lấy `newSha = response.sha`. So sánh `newSha` với `cachedData.sha`.
     - **Nếu SHA thay đổi hoặc chưa có cache**: Giải mã base64 sang UTF-8, cập nhật `appState.currentFileContent`, gọi `renderMarkdown(newContent)`.
     - Áp dụng ngay mức zoom `applyFontScale(appState.fontScale)`.
     - Nếu file này thuộc danh sách Favorites: tự động cập nhật lại bản mới vào IndexedDB (`cacheFavoriteFile(...)`).
     - Cập nhật huy hiệu thành `🟢 Synced (Just now)`.
- **Trạng thái bị ảnh hưởng**: `appState.currentFileContent`, `appState.syncStatus`.
- **Trường hợp biên & Xử lý lỗi**: File >1MB → fetch qua `download_url` (raw.githubusercontent.com); Lỗi mạng mid-flight → tự động fallback dùng bản Cache trong IndexedDB nếu có.
- **Cập nhật DOM**: Render vào `#markdownViewerPanel` với class `markdown-body`; áp dụng `--md-content-scale`; cập nhật huy hiệu trạng thái Sync trên Header.

### 7. Render Markdown với Sơ đồ (Định dạng GitHub Markdown CSS)

- **Kích hoạt**: Được gọi nội bộ sau khi lấy nội dung file (không phải hành động trực tiếp của người dùng).
- **Tên hàm**: `renderMarkdown(rawContent)`
- **Logic từng bước**:
  1. Truyền `rawContent` qua `marked.parse()` với renderer ghi đè tùy chỉnh cho các khối code rào chắn (fenced code blocks).
  2. Trong renderer code: nếu ngôn ngữ là `mermaid`, bọc nội dung trong `<div class="mermaid">{code}</div>` (nguyên bản, không escape) thay vì khối `<pre><code>`.
  3. Nếu ngôn ngữ là `plantuml` hoặc `puml`, gọi `encodePlantUML(code)` và xuất ra `<img src="https://www.plantuml.com/plantuml/svg/{encoded}" alt="PlantUML diagram">`.
  4. Đối với tất cả các ngôn ngữ khác, xuất ra khối `<pre><code class="hljs language-{lang}">` tiêu chuẩn.
  5. Làm sạch chuỗi HTML kết quả bằng `DOMPurify.sanitize()` (cho phép các thẻ `<div>` mermaid và `<img>` sơ đồ).
  6. Chèn vào `#markdownViewerPanel` (đảm bảo chứa class `markdown-body`).
  7. Gọi `mermaid.run()` để render tất cả các div `.mermaid` trên trang.
  8. Gọi `hljs.highlightAll()` cho các khối code còn lại.
  9. Áp dụng lại mức Zoom hiện tại `applyFontScale(appState.fontScale)`.
- **Trạng thái bị ảnh hưởng**: Không có ngoài DOM.
- **Trường hợp biên & Xử lý lỗi**: Cú pháp Mermaid bị sai → Mermaid.js tự hiển thị khung lỗi nội dòng của nó (giữ nguyên, không ẩn); máy chủ PlantUML không truy cập được/timeout → trình xử lý `onerror` của `<img>` chuyển sang khối văn bản dự phòng "Diagram failed to load — view source" hiển thị mã thô.
- **Cập nhật DOM**: Thay thế toàn bộ innerHTML của `#markdownViewerPanel`, sau đó render sơ đồ tại chỗ thông qua `run()` của Mermaid.

### 8. Mã hóa PlantUML (hàm hỗ trợ, không kích hoạt từ UI)

- **Tên hàm**: `encodePlantUML(sourceText)`
- **Logic từng bước**:
  1. Mã hóa UTF-8 `sourceText` thành mảng byte.
  2. Nén Deflate mảng byte bằng `pako.deflateRaw()`.
  3. Mã hóa mảng byte đã nén bằng bảng chữ cái base64 tùy chỉnh của PlantUML (thuật toán dịch bit, nhóm 3-byte thành 4-ký-tự, khác với base64 tiêu chuẩn).
  4. Trả về chuỗi đã mã hóa để chèn vào URL.
- **Trạng thái bị ảnh hưởng**: Không có (hàm thuần túy - pure function).
- **Trường hợp biên & Xử lý lỗi**: Nguồn rỗng → trả về sớm kèm ảnh giữ chỗ/văn bản lỗi, không gọi máy chủ PlantUML.

### 9. Bật/Tắt File Yêu thích (Kèm tự động quản lý Cache)

- **Kích hoạt**: Nhấp vào biểu tượng Octicon Star trên tiêu đề trình xem markdown hoặc thẻ file.
- **Tên hàm**: `toggleFavoriteFile(owner, name, path)`
- **Logic từng bước**:
  1. Kiểm tra xem file `{owner, name, path}` đã có trong `appState.favoriteFiles` chưa.
  2. **Nếu chưa có (Đánh dấu Yêu thích)**:
     - Thêm vào `appState.favoriteFiles`.
     - Lưu lại danh sách vào `localStorage.gh_favorite_files`.
     - Kích hoạt `cacheFavoriteFile(owner, name, path)` để tải và lưu ngay nội dung file vào IndexedDB.
     - Flash alert thông báo: "Saved to favorites & cached offline".
  3. **Nếu đã có (Bỏ Yêu thích)**:
     - Xóa khỏi `appState.favoriteFiles`.
     - Lưu lại mảng mới vào `localStorage.gh_favorite_files`.
     - Xóa dữ liệu cache của file đó khỏi IndexedDB (`idbKeyval.del(fileKey)`).
     - Flash alert thông báo: "Removed from favorites".
  4. Cập nhật biểu tượng sao trên UI (tô màu vàng kim `#E3B341` / viền nét).
- **Trạng thái bị ảnh hưởng**: `appState.favoriteFiles`; localStorage `gh_favorite_files`; IndexedDB.
- **Trường hợp biên & Xử lý lỗi**: Lỗi khi lưu Cache vào IndexedDB → Flash alert cảnh báo "Favorited but failed to cache offline".
- **Cập nhật DOM**: Chuyển đổi class biểu tượng sao; render lại danh sách Favorites nếu đang xem.

### 10. Tìm kiếm / Lọc (Repos và Favorites)

- **Kích hoạt**: Sự kiện `input` trên ô tìm kiếm ở thanh bên (`input.form-control`).
- **Tên hàm**: `filterList(query)`
- **Logic từng bước**:
  1. Chuyển `query` thành chữ thường (lowercase).
  2. Lọc danh sách đang hoạt động (`appState.repos` hoặc `appState.favoriteRepos`/`favoriteFiles`) bằng so sánh chuỗi con trên tên/đường dẫn.
  3. Chỉ render lại danh sách đã lọc, không can thiệp vào trạng thái gốc.
- **Trạng thái bị ảnh hưởng**: Không có (chỉ lọc để hiển thị, không biến đổi `appState.repos`).
- **Trường hợp biên & Xử lý lỗi**: Không có kết quả khớp → hiển thị `blankslate` "No results found for '{query}'".
- **Cập nhật DOM**: Thay thế nội dung khung chứa danh sách bằng kết quả đã lọc.

### 11. Ngắt kết nối / Xóa Token

- **Kích hoạt**: Nhấp vào biểu tượng "cài đặt" → "Disconnect" trong hộp thoại xác nhận GitHub Modal.
- **Tên hàm**: `disconnectToken()`
- **Logic từng bước**:
  1. Hiển thị hộp thoại xác nhận Modal ("This will remove your saved PAT. Favorites and offline cache are kept.").
  2. Khi xác nhận, xóa `appState.token`, xóa `localStorage.gh_pat_token`.
  3. Reset `appState.repos`, `currentRepo`, `currentFileContent` về rỗng/null.
  4. Hiển thị lại thẻ nhập PAT.
- **Trạng thái bị ảnh hưởng**: `appState.token`, `appState.repos`, v.v.; localStorage `gh_pat_token` (giữ nguyên các khóa favorites & cache).
- **Trường hợp biên & Xử lý lỗi**: Không có đáng kể.
- **Cập nhật DOM**: Hiển thị `#patEntryCard`, ẩn `#appShell`.

### 12. Tự động Lưu Cache File Yêu thích (Auto-cache Favorite File)

- **Tên hàm**: `cacheFavoriteFile(owner, name, path)`
- **Logic từng bước**:
  1. Tạo `fileKey = `${owner}/${name}/${path}``.
  2. Nếu `appState.currentFileContent` đang chứa đúng nội dung của file này:
     - Sử dụng trực tiếp nội dung hiện tại và `SHA` để lưu vào IndexedDB.
  3. Nếu chưa có sẵn nội dung trong bộ nhớ:
     - Gọi GitHub API `GET /repos/{owner}/{name}/contents/{path}`.
     - Lấy chuỗi rawContent và `sha`.
  4. Lưu đối tượng `{ fileKey, owner, name, path, content, sha, lastSyncedAt: Date.now() }` vào IndexedDB qua `idbKeyval.set(fileKey, data)`.
  5. Cập nhật `appState.syncStatus[fileKey] = { status: 'synced', lastSyncedAt: Date.now(), sha }`.
- **Trạng thái bị ảnh hưởng**: IndexedDB, `appState.syncStatus`.
- **Trường hợp biên & Xử lý lỗi**: Offline khi kích hoạt → lưu trạng thái chờ hoặc báo không thể cache.

### 13. Đồng bộ hóa File Yêu thích (Sync Single & Sync All)

- **Trigger**: 
  - Nhấp nút "Sync Now" (Octicon Sync) trên thẻ file favorite hoặc header trình đọc.
  - Nhấp nút "Sync All Favorites" ở góc trên danh sách Favorites.
- **Tên hàm**: `syncFavoriteFile(owner, name, path)` & `syncAllFavorites()`
- **Logic cho `syncFavoriteFile`**:
  1. Nếu không có mạng (`appState.isOffline`): Flash alert "Cannot sync offline", abort.
  2. Đặt trạng thái `appState.syncStatus[fileKey].status = 'syncing'`, cập nhật UI icon xoay/spinning.
  3. Gọi GitHub API `GET /repos/{owner}/{name}/contents/{path}`.
  4. Lấy `newSha` và `newContent`.
  5. So sánh với `sha` trong IndexedDB:
     - **Nếu SHA khớp**: Cập nhật `lastSyncedAt = Date.now()`, đổi trạng thái sang `'synced'`. Flash alert "File is already up to date".
     - **Nếu SHA khác**: Cập nhật `content`, `sha`, `lastSyncedAt` mới vào IndexedDB.
       - Nếu file này đang mở ở Viewer: tự động render lại nội dung mới (`renderMarkdown(newContent)`).
       - Flash alert "File synced with latest content!".
- **Logic cho `syncAllFavorites`**:
  1. Duyệt qua mảng `appState.favoriteFiles`.
  2. Gọi lần lượt `syncFavoriteFile(...)` cho từng file (dùng `Promise.allSettled` để không bị nghẽn nếu 1 file lỗi).
  3. Sau khi hoàn tất: Flash alert "Successfully synced X/Y favorite files!".
- **Trạng thái bị ảnh hưởng**: IndexedDB, `appState.syncStatus`, `appState.currentFileContent` (nếu đang xem).
- **Cập nhật DOM**: Cập nhật biểu tượng Octicon và huy hiệu trạng thái Sync.

### 14. Theo dõi & Xử lý Trạng thái Mạng (Online / Offline Event Handling)

- **Trigger**: Sự kiện hệ thống `window.addEventListener('online')` và `window.addEventListener('offline')`.
- **Function name**: `handleNetworkChange()`
- **Logic từng bước**:
  1. Cập nhật `appState.isOffline = !navigator.onLine`.
  2. Khi chuyển sang **Offline**:
     - Cập nhật chỉ báo trên App Bar thành "Offline Mode (Cached)".
     - Vẫn cho phép người dùng nhấp xem các file Favorite (tải từ IndexedDB).
     - Vô hiệu hóa (disable) hoặc ẩn nút Sync All.
  3. Khi chuyển sang **Online**:
     - Cập nhật chỉ báo trên App Bar thành "Online".
     - Tự động kích hoạt `syncAllFavorites()` ngầm để cập nhật dữ liệu mới nhất.
- **Trạng thái bị ảnh hưởng**: `appState.isOffline`.
- **Cập nhật DOM**: Cập nhật thẻ mạng trên GitHub Header Bar và trạng thái vô hiệu hóa của các nút Sync.

### 15. Điều chỉnh Thu phóng Nội dung Tài liệu (Zoom In / Out / Reset Document Content)

- **Trigger**: 
  - Nhấp nút Zoom In (`+`), Zoom Out (`-`), hoặc nhấp thẻ hiển thị tỷ lệ (`100%`) trên Header của trình đọc Markdown hoặc trong Cài đặt.
- **Tên hàm**: `changeFontScale(deltaOrValue)` & `applyFontScale(scale)`
- **Logic từng bước**:
  1. Khi nhấp `+`: Tăng `appState.fontScale` lên +10% (ví dụ từ `100` -> `110`).
  2. Khi nhấp `-`: Giảm `appState.fontScale` đi -10% (ví dụ từ `100` -> `90`).
  3. Khi nhấp vào thẻ tỷ lệ: Đặt `appState.fontScale = 100` (Reset).
  4. Kiểm tra giới hạn biên: Giới hạn `fontScale` nằm trong khoảng tối thiểu **75%** và tối đa **200%**.
  5. Gọi `applyFontScale(appState.fontScale)`:
     - Gán giá trị biến CSS `--md-content-scale: ${scale / 100}` trên phần tử `#markdownViewerPanel.markdown-body`.
     - Cập nhật nhãn hiển thị tỷ lệ trên Header thành `${scale}%`.
  6. Lưu `localStorage.setItem('gh_font_scale', scale.toString())`.
- **Trạng thái bị ảnh hưởng**: `appState.fontScale`, `localStorage.gh_font_scale`.
- **Trường hợp biên & Xử lý lỗi**: Mức zoom vượt quá khoảng 75% - 200% → giữ nguyên ở mức biên và vô hiệu hóa nhẹ nút tương ứng (`disabled` visual cue).
- **Cập nhật DOM**: Đổi biến CSS `--md-content-scale` trên `#markdownViewerPanel.markdown-body`, cập nhật văn bản hiển thị tỷ lệ phần trăm (`${scale}%`).

### 16. Mở/Đóng & Chuyển Tab Hướng dẫn (Toggle & Navigate Help / PAT Creation Guide Modal)

- **Trigger**: 
  - Nhấp nút Trợ giúp `?` (`Octicon Question`) trên GitHub Header Bar.
  - Nhấp đường dẫn *"How to generate a Personal Access Token?"* trên Thẻ nhập PAT.
  - Nhấp nút "Help Guide" trong Cài đặt.
  - Nhấp nút Đóng `✕` trên Modal Hướng dẫn.
- **Tên hàm**: `toggleGuideModal(isOpen, initialTab = 'pat')` & `switchGuideTab(tabName)`
- **Logic từng bước**:
  1. Khi mở modal: Đặt `appState.isGuideOpen = true`, `appState.activeGuideTab = initialTab`.
  2. Render Hộp thoại Hướng dẫn dạng GitHub Modal.
  3. Khi nhấp Tab (`'pat'` hoặc `'features'`): Cập nhật `appState.activeGuideTab = tabName`, kích hoạt hiệu ứng `selected` trên TabNav và đổi nội dung hiển thị tương ứng.
  4. Khi nhấp nút Đóng hoặc nhấp vùng xám ngoài Modal: Đặt `appState.isGuideOpen = false`.
- **Trạng thái bị ảnh hưởng**: `appState.isGuideOpen`, `appState.activeGuideTab`.
- **Cập nhật DOM**: Ẩn/Hiện phần tử `#helpGuideModal`; chuyển đổi trạng thái tab và nội dung hiển thị trong modal body.
