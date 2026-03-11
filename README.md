# Missing Person AR

실종자 사진에서 배경을 자동으로 제거하고,
카메라로 AR(증강현실) 확인이 가능한 **공유 링크**를 생성하는 웹 애플리케이션입니다.

AI 합성 기능으로 얼굴 사진 + 신체 정보 + 옷차림만으로 전신 이미지를 생성할 수도 있습니다.

---

## 사용 흐름

### A. 전신 사진 올리기 (기존 사진 활용)

```
1. [전신 사진 올리기] 선택
2. 갤러리에서 전신 사진 선택
3. AI가 자동으로 배경 제거 (브라우저에서 처리, 서버 전송 없음)
4. [AR로 보기] 클릭 → 서버에 이미지 저장 → 고유 UUID 발급
5. ar.html?id=UUID 로 이동 — 이 URL 자체가 공유 링크
6. 링크 버튼으로 URL 복사 후 공유 → 누구든 카메라로 AR 확인 가능
```

### B. AI 합성하기 (전신 사진이 없을 때)

```
1. [합성하기] 선택
2. 키 / 몸무게 / 나이 입력
3. 얼굴 사진 업로드
4. 옷차림 입력 (텍스트 또는 사진)
5. [합성 시작] → AI가 전신 이미지 생성 + 얼굴 보존 (30~60초)
6. ar.html?id=UUID 로 자동 이동 → AR 공유 링크 사용
```

---

## 기술 스택

| 영역 | 기술 | 비고 |
|------|------|------|
| 서버 | Node.js 18+, Express 5 | |
| 배경 제거 | @imgly/background-removal | CDN, 브라우저에서 실행 (서버 부하 없음) |
| AR 렌더링 | Three.js | CDN |
| 파일 업로드 | multer 2.x | |
| 고유 ID | uuid v4 | |
| 파일 저장 | 로컬 디스크 (`uploads/`) | ⚠️ 운영 환경에서는 클라우드로 교체 권장 |
| AI 전신 생성 | Replicate — `zsxkib/flux-pulid` | 얼굴 보존 + 전신 생성 통합 모델 |
| 옷차림 번역/분석 | OpenAI — `gpt-4o-mini` | 텍스트 번역 + 이미지 Vision 분석 |
| 얼굴 사진 임시 업로드 | FAL.ai Storage | Replicate에 이미지 전달용 |

---

## 설치 및 실행

### 요구사항

- Node.js 18 이상
- **HTTPS 환경 필수** — 카메라 API는 보안 컨텍스트(HTTPS)에서만 동작합니다
- Chrome 브라우저 권장 — 배경 제거 기능이 구형 Safari에서 동작하지 않을 수 있습니다

### 환경변수 설정

프로젝트 루트에 `.env` 파일 생성:

```bash
PORT=3000
REPLICATE_API_TOKEN=r8_xxxxxxxxxxxxxxxxxxxx
OPENAI_API_KEY=sk-xxxxxxxxxxxxxxxxxxxx
FAL_KEY=xxxxxxxxxxxxxxxxxxxx
```

각 API 키 발급:
- Replicate: https://replicate.com/account/api-tokens
- OpenAI: https://platform.openai.com/api-keys
- FAL.ai: https://fal.ai/dashboard/keys

### 설치

```bash
npm install
```

### 실행

```bash
node server.js
# 또는
npm start
```

기본 포트: `3000`
로컬 개발 시: `http://localhost:3000`

> ⚠️ Live Server (VS Code)로 열지 말 것 — API 요청이 Node.js 서버로 가지 않아 동작하지 않습니다.

---

## API

### `POST /api/upload`

배경 제거된 이미지를 업로드하고 공유 URL을 받습니다.

| 항목 | 내용 |
|------|------|
| Content-Type | `multipart/form-data` |
| 필드명 | `image` |
| 허용 형식 | PNG |
| 최대 크기 | 15MB |

**응답 예시**
```json
{
  "id": "a3f2c8d1-9b4e-4f2a-8c1d-123456789abc",
  "url": "https://yourdomain.com/ar.html?id=a3f2c8d1-9b4e-4f2a-8c1d-123456789abc"
}
```

### `POST /api/composite`

얼굴 사진 + 신체 정보로 AI 전신 이미지를 합성합니다.

| 항목 | 내용 |
|------|------|
| Content-Type | `multipart/form-data` |
| `face` | 얼굴 사진 (필수) |
| `outfit` | 옷차림 사진 (선택, `outfitText`와 택1) |
| `outfitText` | 옷차림 텍스트 (선택, `outfit`과 택1) |
| `height` | 키 (cm) |
| `weight` | 몸무게 (kg) |
| `age` | 나이 |

**응답 예시**
```json
{
  "id": "b5e3d9f2-1c6a-4d8b-9e2f-abcdef123456",
  "url": "https://yourdomain.com/ar.html?id=b5e3d9f2-1c6a-4d8b-9e2f-abcdef123456"
}
```

### `GET /api/image/:id`

저장된 이미지를 반환합니다. (UUID 형식만 허용, path traversal 방지 처리됨)

### `GET /api/images`

저장된 이미지 전체 목록을 반환합니다. (관리 페이지용)

### `DELETE /api/image/:id`

이미지를 수동으로 삭제합니다.

---

## 파일 구조

```
.
├── server.js              # Express 서버 — API + 정적 파일 서빙
├── package.json
├── .env                   # 환경변수 (git 제외, 직접 생성 필요)
├── uploads/               # 업로드된 이미지 저장 (24시간 후 자동 삭제)
└── public/
    ├── index.html         # 메인 페이지 (전신 사진 올리기 / 합성하기 선택)
    ├── composite.html     # AI 합성 입력 폼
    ├── ar.html            # AR 뷰어 + 링크 복사 버튼
    ├── admin.html         # 이미지 관리 페이지 (목록 조회 / 수동 삭제)
    ├── css/
    │   ├── index.css
    │   ├── composite.css
    │   └── ar.css
    └── js/
        ├── index.js       # 배경 제거 + 서버 업로드 로직
        ├── composite.js   # AI 합성 폼 + API 호출
        └── ar.js          # Three.js AR + URL 파라미터 이미지 로드
```

---

## 납품받은 회사가 해야 할 일

### ✅ 필수

#### 1. HTTPS 설정

카메라 API는 반드시 HTTPS에서만 동작합니다.

```
방법 A: nginx + Let's Encrypt SSL 인증서 적용
방법 B: Cloudflare 프록시 (무료 SSL)
방법 C: AWS ALB / Load Balancer SSL 처리
```

#### 2. API 키 발급 및 `.env` 작성

합성 기능은 아래 3개 외부 API를 사용합니다. 각 서비스에 가입 후 키를 발급받아 `.env`에 입력하세요.

| 환경변수 | 서비스 | 용도 | 비용 |
|----------|--------|------|------|
| `REPLICATE_API_TOKEN` | Replicate | AI 전신 이미지 생성 | 선불 크레딧 |
| `OPENAI_API_KEY` | OpenAI | 옷차림 번역 + 사진 분석 | 사용량 후불 |
| `FAL_KEY` | FAL.ai | 얼굴 사진 임시 업로드 | 무료 한도 있음 |

#### 3. Replicate 크레딧 충전

합성 기능은 Replicate AI API를 사용하며, **선불 크레딧** 방식입니다.

- 충전 URL: https://replicate.com/account/billing
- 월정액 아님 — 크레딧 소진 시 자동 중단 (추가 청구 없음)
- 자동 재충전 설정 가능

**합성 1회 예상 비용**

| 항목 | 비용 |
|------|------|
| 전신 생성 + 얼굴 보존 (flux-pulid) | ~$0.003 |
| 옷차림 번역/분석 (gpt-4o-mini) | ~$0.001 미만 |
| **합계** | **~$0.003~0.004 (약 4~6원)** |

> $5 충전 시 약 1,200~1,500회 합성 가능

#### 4. 서버 상시 실행 유지

서버가 꺼지면 공유 링크가 동작하지 않습니다. PM2 등으로 항상 실행 상태를 유지하세요.

```bash
# PM2 설치
npm install -g pm2

# 서버 시작
pm2 start server.js --name missing-person-ar

# 서버 재시작 시 자동 실행 등록
pm2 save
pm2 startup
```

#### 5. 방화벽 포트 오픈

```
서버 포트 3000 (또는 .env의 PORT 값) 인바운드 허용
nginx 사용 시: 80, 443 허용 후 3000으로 프록시
```

---

### ⚙️ 권장 (운영 환경)

#### 6. 파일 저장소를 클라우드로 교체

현재는 로컬 디스크(`uploads/`)에 저장합니다.
서버가 재배포되거나 재시작될 경우 자동 삭제 타이머가 초기화되고, 여러 서버로 확장 시 파일이 유실될 수 있습니다.

**교체 위치**: `server.js` 내 `[납품 교체 포인트]` 주석 두 곳

```
현재: 로컬 파일시스템 (uploads/)
교체: AWS S3 / NCP Object Storage / Cloudflare R2 등
```

교체 시 수정 범위:
- `POST /api/upload` — `multer.diskStorage` → `multer.memoryStorage` + 클라우드 SDK 업로드
- `GET /api/image/:id` — `res.sendFile` → 클라우드 URL 리다이렉트 또는 스트림

#### 7. nginx 리버스 프록시 설정 예시

```nginx
server {
    listen 443 ssl;
    server_name yourdomain.com;

    ssl_certificate /etc/letsencrypt/live/yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/yourdomain.com/privkey.pem;

    client_max_body_size 20M;

    location / {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 120s;  # AI 합성 대기 시간 고려
    }
}
```

---

### 🔒 선택 (보안 강화)

#### 8. 관리 페이지 접근 제한

`/admin.html`은 현재 인증 없이 누구든 접근 가능합니다.
내부망 전용이거나 외부 접근 차단이 필요한 경우 nginx에서 IP 제한을 추가하세요.

```nginx
location /admin.html {
    allow 192.168.1.0/24;  # 내부망 IP 대역
    deny all;
}
```

#### 9. 업로드 속도 제한

```bash
npm install express-rate-limit
```

`POST /api/upload`, `POST /api/composite`에 rate limiting을 적용하면 의도치 않은 대량 요청을 방지할 수 있습니다.

---

## 이미지 자동 삭제 정책

업로드된 이미지는 **24시간 후 자동 삭제**됩니다.

- 서버 기동 시: 24시간 이상 된 파일 즉시 정리
- 업로드 시: 24시간 후 삭제 예약 (`setTimeout`)
- 수동 삭제: 관리 페이지(`/admin.html`) 또는 `DELETE /api/image/:id` API

> ⚠️ 서버가 재시작되면 `setTimeout` 타이머가 초기화됩니다.
> 재시작 시 서버 기동 로직이 24시간 초과 파일을 정리하지만,
> 아직 24시간이 안 된 파일의 타이머는 새로 등록되지 않습니다.
> 운영 환경에서는 클라우드 스토리지의 만료 정책 또는 DB 기반 삭제 스케줄러 사용을 권장합니다.

---

## 현재 제한사항

| 항목 | 현재 상태 | 해결 방법 |
|------|-----------|-----------|
| 파일 저장 위치 | 로컬 디스크 | 클라우드 스토리지(S3 등)로 교체 |
| 이미지 만료 | 24시간 자동 삭제 (재시작 시 타이머 초기화) | DB 기반 스케줄러 또는 클라우드 만료 정책 |
| 관리 페이지 인증 | 없음 | nginx IP 제한 또는 Basic Auth |
| 스케일 아웃 | 단일 서버만 지원 | 공유 스토리지 적용 후 다중 서버 가능 |
| 이미지 크기 제한 | 15MB (업로드) / 10MB (합성) | `server.js` `fileSize` 값 수정 |
| AI 합성 비용 | 회당 약 $0.003~0.004 | Replicate 크레딧 선불 충전 필요 |
| 브라우저 호환 | Chrome 권장 | 구형 Safari 배경 제거 불가 |
