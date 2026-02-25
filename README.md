# AR Vision Engine

WebAssembly 기반 AR(증강현실) 엔진입니다. SLAM, Visual Odometry, 평면 감지 등을 지원하며, Three.js를 통해 3D 렌더링을 수행합니다.

## 주요 기능

### 1. SLAM 시스템
- **ORB 특징점 검출**: 프레임당 최대 2000개 특징점 추출
- **Essential Matrix 기반 포즈 추정**: RANSAC을 통한 강건한 카메라 포즈 계산
- **키프레임 관리**: 자동 키프레임 생성 및 맵 포인트 관리
- **삼각측량**: 두 키프레임 간 3D 맵 포인트 생성
- **루프 클로징**: 이전 방문 지역 감지 및 드리프트 보정

### 2. Visual Odometry (VO)
- **FAST 특징점 검출**: 빠른 코너 검출
- **Lucas-Kanade Optical Flow**: 특징점 추적
- **실시간 포즈 추정**: 프레임 간 카메라 움직임 계산
- **View Matrix 출력**: Three.js/WebGL 호환 4x4 행렬 제공

### 3. 평면 감지 (Plane Detection)
- **RANSAC 기반 평면 피팅**: 3D 포인트 클라우드에서 평면 검출
- **수평/수직 평면 분류**: 바닥, 벽 등 구분
- **평면 병합**: 인접한 평면 자동 병합
- **경계 계산**: 감지된 평면의 크기 및 코너 좌표 제공

### 4. Hit Test (레이캐스팅)
- **스크린 좌표 → 3D 교차점**: 터치/클릭 위치의 실제 3D 좌표 계산
- **평면 기반 배치**: 감지된 평면 위에 가상 객체 배치 지원

### 5. 이미지 타겟 트래킹
- **마커 기반 AR**: 사전 등록된 이미지 인식 및 추적
- **6DoF 포즈 추정**: 타겟의 위치와 방향 계산

### 6. 3D 렌더링 (Three.js)
- **3-Layer 시스템**:
  - Layer 1: 카메라 비디오 (배경)
  - Layer 2: Three.js 3D 렌더링 (투명 배경)
  - Layer 3: 실시간 합성
- **크로마키 셰이더**: 초록색 배경 영상 실시간 제거
- **HUD 모드**: 화면에 고정된 영상/객체 렌더링

### 7. 센서 융합 (폴백)
- **DeviceOrientation**: 자이로스코프 기반 카메라 회전
- **하이브리드 모드**: SLAM + 센서 조합 추적

### 8. 제스처 지원
- **드래그**: HUD 객체 이동
- **핀치**: 객체 크기 조절
- **더블탭**: 객체 배치

## 기술 스택

| 구분 | 기술 |
|------|------|
| 프론트엔드 | JavaScript, Three.js |
| 컴퓨터 비전 | C++, OpenCV (WebAssembly) |
| 빌드 | Webpack, Emscripten |
| 서버 | Express.js |

## 프로젝트 구조

```
ar-engine/
├── src/
│   ├── js/                    # JavaScript 모듈
│   │   ├── main.js            # 앱 진입점 (ARApp 클래스)
│   │   ├── AREngine.js        # Wasm 모듈 래퍼
│   │   ├── CameraPoseManager.js   # 카메라 포즈 관리
│   │   ├── VisualOdometry.js  # VO JavaScript 래퍼
│   │   ├── camera.js          # 카메라 유틸리티
│   │   ├── SensorFusion.js    # 센서 융합
│   │   └── DisplaySystem.js   # 렌더링 시스템
│   │
│   └── cpp/                   # C++ 모듈 (Wasm)
│       ├── ar_tracker.cpp     # AR 트래커 메인
│       ├── slam_system.cpp    # SLAM 코어
│       ├── visual_odometry.cpp    # Visual Odometry
│       ├── plane_detector.cpp # 평면 감지
│       ├── hit_test.cpp       # Hit Test (레이캐스팅)
│       ├── feature_matcher.cpp    # 특징점 매칭
│       └── image_target.cpp   # 이미지 타겟
│
├── server.js                  # Express 서버
├── webpack.config.js          # Webpack 설정
└── package.json
```

## 설치 및 실행

```bash
# 의존성 설치
npm install

# 개발 서버 실행
npm run dev

# 프로덕션 빌드
npm run build

# Wasm 빌드 (Emscripten 필요)
npm run build:wasm

# 전체 빌드
npm run build:all
```

브라우저에서 `http://localhost:8080` 접속

## 사용법

```javascript
// AR 앱 초기화 (권한 승인 후)
window.addEventListener('permissionsGranted', () => {
    window.arApp.init();
});

// 추적 모드 변경
window.setARTrackingMode('hybrid');  // 'sensor' | 'slam' | 'hybrid'

// 포즈 리셋
window.resetARPose();

// 영상 변경
window.changeARVideo('video-file.mp4');
```

## 지원 환경

- iOS 13+ Safari
- Android Chrome
- 데스크탑 Chrome/Firefox (WebRTC 카메라 지원)

## 의존성

- **three.js**: 3D 렌더링
- **gl-matrix**: 행렬 연산
- **express**: 개발 서버
- **OpenCV**: 컴퓨터 비전 (Wasm)

## 개발 로드맵

- [x] Phase 1: 환경 구축
- [x] Phase 2: Three.js 렌더링
- [x] Phase 3: 카메라 통합
- [x] Phase 4: Feature Detection
- [x] Phase 5: 평면 감지
- [x] Phase 6: 객체 배치
- [x] Phase 7: SLAM 시스템
- [x] Phase 8: Visual Odometry
- [x] Phase 9: HUD 모드 & 크로마키

## 라이선스

MIT License
