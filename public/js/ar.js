// __GRANITE_NATIVE_EMITTER가 없으면 직접 생성 (web-bridge 모듈 없이 사용 시 필요)
        if (!window.__GRANITE_NATIVE_EMITTER) {
            window.__GRANITE_NATIVE_EMITTER = {
                _events: {},
                emit: function(event, data) {
                    var cbs = this._events[event] || [];
                    for (var i = 0; i < cbs.length; i++) cbs[i](data);
                },
                on: function(event, cb) {
                    var self = this;
                    if (!self._events[event]) self._events[event] = [];
                    self._events[event].push(cb);
                    return function() {
                        self._events[event] = (self._events[event] || []).filter(function(fn) { return fn !== cb; });
                    };
                }
            };
        }
        function _nativeEventId() {
            return Math.random().toString(36).substring(2, 15);
        }
        function _callBridge(method, params) {
            return new Promise(function(resolve, reject) {
                if (!window.ReactNativeWebView) {
                    reject(new Error('bridge_unavailable'));
                    return;
                }
                var id = _nativeEventId();
                var subs = [];
                subs.push(window.__GRANITE_NATIVE_EMITTER.on(method + '/resolve/' + id, function(data) {
                    subs.forEach(function(fn) { fn(); });
                    resolve(data);
                }));
                subs.push(window.__GRANITE_NATIVE_EMITTER.on(method + '/reject/' + id, function(err) {
                    subs.forEach(function(fn) { fn(); });
                    reject(err);
                }));
                window.ReactNativeWebView.postMessage(JSON.stringify({
                    type: 'method', functionName: method, eventId: id, args: [params]
                }));
            });
        }
        async function _requestCameraPermission() {
            try {
                await _callBridge('requestPermission', { name: 'camera', access: 'access' });
                console.log('[AR] 카메라 권한 요청 완료');
            } catch (e) {
                console.warn('[AR] 카메라 권한 요청 실패 (비WebView 환경):', e.message);
            }
        }
        async function _saveToGallery(blob) {
            // granite.config.ts에 photos 권한이 선언되어 있으므로 런타임 요청 불필요
            // saveBase64Data 직접 호출
            return new Promise(function(resolve, reject) {
                var reader = new FileReader();
                reader.onload = async function(e) {
                    var base64 = e.target.result.split(',')[1];
                    var fileName = 'ar-capture-' + Date.now() + '.jpg';
                    console.log('[AR] base64 길이:', base64.length);
                    try {
                        await _callBridge('saveBase64Data', { data: base64, fileName: fileName, mimeType: 'image/jpeg' });
                        resolve('saved');
                    } catch (bridgeErr) {
                        var msg = bridgeErr && bridgeErr.message ? bridgeErr.message : JSON.stringify(bridgeErr);
                        console.error('[AR] saveBase64Data 실패:', msg);
                        reject(new Error('save_failed: ' + msg));
                    }
                };
                reader.readAsDataURL(blob);
            });
        }

// === State ===
        let video = null;
        let scene = null;
        let camera = null;
        let renderer = null;
        let hudMesh = null;
        let hudTexture = null;
        let hudMeshBaseScale = 1.0;
        let isRunning = false;
        let currentFacing = 'environment';
        let lastCapturedBlob = null;
        let logoImage = null; // 로고 프리로드용

        // 제스처 상태
        const gesture = {
            isDragging: false,
            isPinching: false,
            dragStartX: 0,
            dragStartY: 0,
            objStartX: 0,
            objStartY: 0,
            pinchStartDist: 0,
            pinchStartScale: 1.0,
        };

        // IndexedDB 헬퍼 함수
        function openImageDB() {
            return new Promise((resolve, reject) => {
                const request = indexedDB.open('ARImageDB', 1);
                request.onerror = () => reject(request.error);
                request.onsuccess = () => resolve(request.result);
                request.onupgradeneeded = (e) => {
                    const db = e.target.result;
                    if (!db.objectStoreNames.contains('images')) {
                        db.createObjectStore('images', { keyPath: 'id' });
                    }
                };
            });
        }

        async function getImageFromDB() {
            const db = await openImageDB();
            return new Promise((resolve, reject) => {
                const tx = db.transaction('images', 'readonly');
                const store = tx.objectStore('images');
                const request = store.get('arImage');
                request.onsuccess = () => {
                    db.close();
                    if (request.result && request.result.blob) {
                        resolve(request.result.blob);
                    } else {
                        resolve(null);
                    }
                };
                request.onerror = () => {
                    db.close();
                    reject(request.error);
                };
            });
        }

        // === 초기화 ===
        async function init() {
            console.log('[AR] 초기화 시작');
            document.getElementById('loading-screen').classList.remove('hidden');

            // IndexedDB에서 이미지 불러오기
            let imageBlob = null;
            try {
                imageBlob = await getImageFromDB();
            } catch (e) {
                console.error('[AR] IndexedDB 에러:', e);
            }

            if (!imageBlob) {
                showError('이미지가 없습니다. 먼저 이미지를 업로드해주세요.');
                return;
            }

            try {
                updateLoading('카메라 연결 중...');
                await initCamera();

                updateLoading('3D 엔진 초기화...');
                initThreeJS();

                updateLoading('이미지 로딩...');
                await loadImageFromBlob(imageBlob);

                initEvents();

                // 로고 프리로드
                logoImage = new Image();
                logoImage.src = 'logo.png';
                logoImage.onerror = () => logoImage.src = 'el-logo.png';

                hideLoading();
                showHint();

                isRunning = true;
                animate();

                console.log('[AR] 초기화 완료');

            } catch (error) {
                console.error('[AR] 초기화 실패:', error);
                showError('초기화 실패: ' + error.message);
            }
        }

        // === 카메라 초기화 ===
        async function initCamera() {
            video = document.getElementById('video-background');
            if (!video) throw new Error('비디오 요소를 찾을 수 없습니다.');

            // 토스 WebView: 네이티브 브릿지로 카메라 권한 먼저 요청
            await _requestCameraPermission();

            // iOS WebView/Safari: 카메라 API 사용 가능 여부 확인
            if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
                throw new Error('이 브라우저에서는 카메라를 사용할 수 없습니다. Safari 또는 앱을 최신 버전으로 업데이트해 주세요.');
            }

            // iOS 필수: muted, playsInline 명시적 설정 (일부 환경에서 HTML 속성만으로는 부족)
            video.muted = true;
            video.setAttribute('playsinline', '');
            video.setAttribute('webkit-playsinline', '');

            try {
                // 후면 카메라 시도 (exact 제거 - iOS 일부 기기에서 exact로 실패)
                let stream;
                try {
                    stream = await navigator.mediaDevices.getUserMedia({
                        video: {
                            facingMode: 'environment',
                            width: { ideal: 1280 },
                            height: { ideal: 720 }
                        }
                    });
                } catch (envErr) {
                    console.warn('[AR] 후면 카메라 실패, 기본 카메라 시도:', envErr.message);
                    stream = await navigator.mediaDevices.getUserMedia({ video: true });
                }

                video.srcObject = stream;

                // iOS: 스트림이 비디오에 적용될 때까지 대기 후 play (직접 play() 시 타이밍 이슈로 실패할 수 있음)
                await new Promise((resolve, reject) => {
                    let done = false;
                    const doneWith = (err) => {
                        if (done) return;
                        done = true;
                        clearTimeout(tid);
                        video.removeEventListener('loadedmetadata', onReady);
                        video.removeEventListener('error', onErr);
                        err ? reject(err) : resolve();
                    };
                    const onReady = () => doneWith(null);
                    const onErr = (e) => doneWith(new Error(e.message || '비디오 로드 실패'));
                    video.addEventListener('loadedmetadata', onReady);
                    video.addEventListener('error', onErr);
                    if (video.readyState >= 1) {
                        doneWith(null);
                        return;
                    }
                    const tid = setTimeout(() => {
                        if (video.readyState >= 1) doneWith(null);
                        else doneWith(new Error('비디오 스트림 준비 시간 초과'));
                    }, 3000);
                });

                const playPromise = video.play();
                if (playPromise !== undefined) {
                    await playPromise;
                }
                currentFacing = 'environment';

                console.log('[AR] 카메라 연결됨:', video.videoWidth, 'x', video.videoHeight);

            } catch (e) {
                console.error('[AR] 카메라 에러:', e.name, e.message, e);
                if (e.name === 'NotAllowedError' || e.name === 'PermissionDeniedError') {
                    throw new Error('카메라 권한이 거부되었습니다. 설정에서 카메라를 허용해 주세요.');
                }
                throw new Error('카메라 연결 실패: ' + (e.message || e.name || String(e)));
            }
        }

        // === Three.js 초기화 ===
        function initThreeJS() {
            const container = document.getElementById('canvas-container');

            scene = new THREE.Scene();
            scene.background = null;

            camera = new THREE.PerspectiveCamera(
                70,
                window.innerWidth / window.innerHeight,
                0.01,
                1000
            );
            camera.position.set(0, 0, 0);
            scene.add(camera);

            renderer = new THREE.WebGLRenderer({
                antialias: true,
                alpha: true,
                premultipliedAlpha: false,
                preserveDrawingBuffer: true
            });
            renderer.setPixelRatio(window.devicePixelRatio);
            renderer.setSize(window.innerWidth, window.innerHeight);
            renderer.setClearColor(0x000000, 0);
            renderer.domElement.style.position = 'absolute';
            renderer.domElement.style.top = '0';
            renderer.domElement.style.left = '0';
            renderer.domElement.style.zIndex = '1';
            renderer.domElement.style.pointerEvents = 'none';

            container.appendChild(renderer.domElement);

            const ambient = new THREE.AmbientLight(0xffffff, 1.0);
            scene.add(ambient);

            console.log('[AR] Three.js 초기화 완료');
        }

        // === 이미지 로딩 (Blob에서) ===
        async function loadImageFromBlob(blob) {
            const objectURL = URL.createObjectURL(blob);
            try {
                await loadImage(objectURL);
            } finally {
                URL.revokeObjectURL(objectURL);
            }
        }

        // === 이미지 로딩 (URL에서) ===
        async function loadImage(imageURL) {
            return new Promise((resolve, reject) => {
                const img = new Image();
                img.onload = () => {
                    hudTexture = new THREE.Texture(img);
                    hudTexture.colorSpace = THREE.SRGBColorSpace;
                    hudTexture.minFilter = THREE.LinearFilter;
                    hudTexture.magFilter = THREE.LinearFilter;
                    hudTexture.needsUpdate = true;

                    const material = new THREE.MeshBasicMaterial({
                        map: hudTexture,
                        transparent: true,
                        side: THREE.DoubleSide,
                        depthWrite: false,
                    });

                    const aspect = img.width / img.height;
                    const height = 0.5;
                    const width = height * aspect;

                    const geometry = new THREE.PlaneGeometry(width, height);
                    hudMesh = new THREE.Mesh(geometry, material);

                    hudMesh.position.set(0, 0, -1.5);
                    hudMeshBaseScale = 1.0;
                    hudMesh.scale.set(1, 1, 1);

                    camera.add(hudMesh);

                    console.log('[AR] 이미지 로딩 완료:', img.width, 'x', img.height);
                    resolve();
                };
                img.onerror = () => reject(new Error('이미지 로딩 실패'));
                img.src = imageURL;
            });
        }

        // === 이벤트 설정 ===
        function initEvents() {
            const touchArea = document.getElementById('touch-area');

            // 터치 이벤트
            touchArea.addEventListener('touchstart', (e) => {
                e.preventDefault();
                if (!hudMesh) return;

                if (e.touches.length === 1) {
                    gesture.isDragging = true;
                    gesture.isPinching = false;
                    gesture.dragStartX = e.touches[0].clientX;
                    gesture.dragStartY = e.touches[0].clientY;
                    gesture.objStartX = hudMesh.position.x;
                    gesture.objStartY = hudMesh.position.y;
                } else if (e.touches.length === 2) {
                    gesture.isDragging = false;
                    gesture.isPinching = true;
                    gesture.pinchStartDist = getTouchDistance(e.touches);
                    gesture.pinchStartScale = hudMeshBaseScale;
                }
            }, { passive: false });

            touchArea.addEventListener('touchmove', (e) => {
                e.preventDefault();
                if (!hudMesh) return;

                if (gesture.isDragging && e.touches.length === 1) {
                    const dx = e.touches[0].clientX - gesture.dragStartX;
                    const dy = e.touches[0].clientY - gesture.dragStartY;
                    const scale = screenPixelToLocal();
                    hudMesh.position.x = gesture.objStartX + dx * scale;
                    hudMesh.position.y = gesture.objStartY - dy * scale;
                } else if (gesture.isPinching && e.touches.length === 2) {
                    const dist = getTouchDistance(e.touches);
                    const ratio = dist / gesture.pinchStartDist;
                    hudMeshBaseScale = Math.max(0.3, Math.min(5.0, gesture.pinchStartScale * ratio));
                    hudMesh.scale.set(hudMeshBaseScale, hudMeshBaseScale, hudMeshBaseScale);
                }
            }, { passive: false });

            touchArea.addEventListener('touchend', (e) => {
                if (e.touches.length === 0) {
                    gesture.isDragging = false;
                    gesture.isPinching = false;
                } else if (e.touches.length === 1) {
                    gesture.isPinching = false;
                    gesture.isDragging = true;
                    gesture.dragStartX = e.touches[0].clientX;
                    gesture.dragStartY = e.touches[0].clientY;
                    gesture.objStartX = hudMesh ? hudMesh.position.x : 0;
                    gesture.objStartY = hudMesh ? hudMesh.position.y : 0;
                }
            });

            // 마우스 이벤트 (데스크탑)
            let mouseDown = false;
            touchArea.addEventListener('mousedown', (e) => {
                if (!hudMesh) return;
                mouseDown = true;
                gesture.dragStartX = e.clientX;
                gesture.dragStartY = e.clientY;
                gesture.objStartX = hudMesh.position.x;
                gesture.objStartY = hudMesh.position.y;
            });

            touchArea.addEventListener('mousemove', (e) => {
                if (!mouseDown || !hudMesh) return;
                const dx = e.clientX - gesture.dragStartX;
                const dy = e.clientY - gesture.dragStartY;
                const scale = screenPixelToLocal();
                hudMesh.position.x = gesture.objStartX + dx * scale;
                hudMesh.position.y = gesture.objStartY - dy * scale;
            });

            touchArea.addEventListener('mouseup', () => { mouseDown = false; });
            touchArea.addEventListener('mouseleave', () => { mouseDown = false; });

            // 마우스 휠
            touchArea.addEventListener('wheel', (e) => {
                if (!hudMesh) return;
                e.preventDefault();
                const delta = e.deltaY > 0 ? 0.9 : 1.1;
                hudMeshBaseScale = Math.max(0.3, Math.min(5.0, hudMeshBaseScale * delta));
                hudMesh.scale.set(hudMeshBaseScale, hudMeshBaseScale, hudMeshBaseScale);
            }, { passive: false });

            // 버튼 이벤트
            document.getElementById('btn-back').addEventListener('click', () => {
                window.location.href = 'upload.html';
            });

            document.getElementById('btn-switch-camera').addEventListener('click', switchCamera);

            document.getElementById('btn-new-image').addEventListener('click', () => {
                window.location.href = 'upload.html';
            });

            document.getElementById('btn-capture').addEventListener('click', captureScreen);

            document.getElementById('btn-download').addEventListener('click', downloadCapture);

            // 안내 오버레이 터치하면 사라짐
            document.getElementById('hint-overlay').addEventListener('click', () => {
                document.getElementById('hint-overlay').classList.remove('visible');
            });

            // 리사이즈
            window.addEventListener('resize', onResize);

            console.log('[AR] 이벤트 설정 완료');
        }

        // === 유틸리티 함수 ===
        function getTouchDistance(touches) {
            const dx = touches[0].clientX - touches[1].clientX;
            const dy = touches[0].clientY - touches[1].clientY;
            return Math.sqrt(dx * dx + dy * dy);
        }

        function screenPixelToLocal() {
            const distance = 1.5;
            const fovRad = THREE.MathUtils.degToRad(camera.fov);
            const screenHeight = window.innerHeight;
            return (2 * distance * Math.tan(fovRad / 2)) / screenHeight;
        }

        // === 카메라 전환 ===
        async function switchCamera() {
            currentFacing = currentFacing === 'environment' ? 'user' : 'environment';

            try {
                if (video.srcObject) {
                    video.srcObject.getTracks().forEach(t => t.stop());
                }

                const stream = await navigator.mediaDevices.getUserMedia({
                    video: {
                        facingMode: currentFacing,
                        width: { ideal: 1280 },
                        height: { ideal: 720 }
                    }
                });

                video.srcObject = stream;
                video.classList.toggle('mirror', currentFacing === 'user');
                await video.play();

                console.log('[AR] 카메라 전환:', currentFacing);

            } catch (e) {
                console.error('[AR] 카메라 전환 실패:', e);
            }
        }

        // === 화면 캡처 ===
        async function captureScreen() {
            console.log('[AR] captureScreen 호출됨');
            const arCanvas = document.querySelector('#canvas-container canvas');
            if (!video || !arCanvas) {
                console.error('[AR] 비디오 또는 AR 캔버스를 찾을 수 없음', { video: !!video, arCanvas: !!arCanvas });
                alert('카메라 또는 AR 화면을 준비할 수 없습니다.');
                return;
            }

            try {
                // 플래시 효과
                const flash = document.getElementById('capture-flash');
                flash.classList.add('flash');
                setTimeout(() => flash.classList.remove('flash'), 100);

                showToast('캡처 중... 잠시만 기다려주세요');

                // 캡처용 임시 캔버스 생성
                const canvas = document.createElement('canvas');
                canvas.width = arCanvas.width;
                canvas.height = arCanvas.height;
                const ctx = canvas.getContext('2d');

                // 전면 카메라 미러링 처리
                const isMirrored = currentFacing === 'user';
                drawVideoCover(ctx, video, canvas.width, canvas.height, isMirrored);

                // AR 오버레이 합성
                ctx.drawImage(arCanvas, 0, 0);

                // 3. 워터마크 로고 직접 합성 (비율 유지)
                if (logoImage && logoImage.complete && logoImage.naturalWidth > 0) {
                    const logoAspect = logoImage.naturalWidth / logoImage.naturalHeight;
                    const lWidth = Math.min(canvas.width, canvas.height) * 0.20;
                    const lHeight = lWidth / logoAspect;

                    const lMargin = 30;
                    const lx = canvas.width - lWidth - lMargin;
                    const ly = canvas.height - lHeight - lMargin;

                    ctx.save();
                    ctx.globalAlpha = 0.6; // 워터마크용 투명도
                    ctx.drawImage(logoImage, lx, ly, lWidth, lHeight);
                    ctx.restore();
                    console.log('[AR] 워터마크 직접 합성 완료 (비율 유지)');
                } else {
                    console.warn('[AR] 워터마크 이미지가 준비되지 않아 텍스트로 보완');
                    ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
                    ctx.font = 'bold 30px sans-serif';
                    ctx.fillText('LOGO', canvas.width - 150, canvas.height - 50);
                }

                // 최후의 데이터를 Blob으로 변환 (JPEG 85%로 용량 축소)
                canvas.toBlob((blob) => {
                    if (blob) {
                        lastCapturedBlob = blob;
                        console.log('[AR] 캡처 Blob 크기:', (blob.size / 1024).toFixed(0) + 'KB');

                        // 다운로드 버튼 활성화
                        const downloadBtn = document.getElementById('btn-download');
                        downloadBtn.style.opacity = '1';
                        downloadBtn.style.pointerEvents = 'auto';

                        showToast('촬영 완료! 저장 버튼을 누르세요.');
                    } else {
                        console.error('[AR] Blob 생성 실패');
                        showToast('캡처 실패 (Canvas 오류)');
                    }
                }, 'image/jpeg', 0.85);

            } catch (err) {
                console.error('[AR] 캡처 중 치명적 오류:', err);
                alert('캡처 중 오류가 발생했습니다: ' + err.message);
            }
        }

        // object-fit: cover 방식으로 비디오를 캔버스에 그리기
        function drawVideoCover(ctx, video, canvasWidth, canvasHeight, mirror = false) {
            const videoWidth = video.videoWidth;
            const videoHeight = video.videoHeight;
            if (videoWidth === 0 || videoHeight === 0) return;

            const videoRatio = videoWidth / videoHeight;
            const canvasRatio = canvasWidth / canvasHeight;

            let sx, sy, sWidth, sHeight;

            if (videoRatio > canvasRatio) {
                sHeight = videoHeight;
                sWidth = videoHeight * canvasRatio;
                sx = (videoWidth - sWidth) / 2;
                sy = 0;
            } else {
                sWidth = videoWidth;
                sHeight = videoWidth / canvasRatio;
                sx = 0;
                sy = (videoHeight - sHeight) / 2;
            }

            if (mirror) {
                ctx.save();
                ctx.scale(-1, 1);
                ctx.drawImage(video, sx, sy, sWidth, sHeight, -canvasWidth, 0, canvasWidth, canvasHeight);
                ctx.restore();
            } else {
                ctx.drawImage(video, sx, sy, sWidth, sHeight, 0, 0, canvasWidth, canvasHeight);
            }
        }

        // === 다운로드 ===
        async function downloadCapture() {
            if (!lastCapturedBlob) {
                showToast('먼저 촬영(동그란 버튼)을 해주세요!');
                return;
            }

            showToast('저장 중...');

            try {
                await _saveToGallery(lastCapturedBlob);
                showToast('갤러리에 저장되었습니다');
            } catch (err) {
                var errMsg = err && err.message ? err.message : String(err);
                console.error('[AR] 저장 실패:', errMsg);
                showToast('저장 실패: ' + errMsg);
            }
        }

        // === 리사이즈 ===
        function onResize() {
            const width = window.innerWidth;
            const height = window.innerHeight;

            camera.aspect = width / height;
            camera.updateProjectionMatrix();
            renderer.setSize(width, height);
        }

        // === UI 함수 ===
        function updateLoading(text) {
            document.getElementById('loading-text').textContent = text;
        }

        function hideLoading() {
            document.getElementById('loading-screen').classList.add('hidden');
        }

        function showError(message) {
            document.getElementById('loading-screen').classList.add('hidden');
            document.getElementById('error-message').textContent = message;
            document.getElementById('error-screen').classList.add('visible');
        }

        function showHint() {
            const hint = document.getElementById('hint-overlay');
            hint.classList.add('visible');
        }

        function showToast(message) {
            const toast = document.getElementById('toast');
            toast.textContent = message;
            toast.classList.add('visible');
            setTimeout(() => {
                toast.classList.remove('visible');
            }, 2000);
        }

        // === 렌더 루프 ===
        function animate() {
            if (!isRunning) return;
            requestAnimationFrame(animate);
            renderer.render(scene, camera);
        }

        // === 시작 (iOS: 사용자 탭 후 init으로 제스처 확보) ===
        (async function start() {
            let imageBlob = null;
            try {
                imageBlob = await getImageFromDB();
            } catch (e) {
                console.error('[AR] IndexedDB 에러:', e);
            }
            if (!imageBlob) {
                showError('이미지가 없습니다. 먼저 이미지를 업로드해주세요.');
                return;
            }
            const tapEl = document.getElementById('tap-to-start');
            tapEl.addEventListener('click', function onTap() {
                tapEl.removeEventListener('click', onTap);
                tapEl.classList.add('hidden');
                init();
            }, { once: true });
        })();
