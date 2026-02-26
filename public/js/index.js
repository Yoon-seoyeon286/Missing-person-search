//@imgly/background-removal
import { removeBackground } from 'https://cdn.jsdelivr.net/npm/@imgly/background-removal@1.5.1/+esm';

        // 처리된 이미지 Blob
        let processedImageBlob = null;
        let selectedFile = null;

        // DOM 로드 후 실행
        document.addEventListener('DOMContentLoaded', () => {
            console.log('[Upload] DOM 로드 완료');
            initApp();
        });

        //초기화!
        function initApp() {
            // 요소 참조
            const uploadArea = document.getElementById('upload-area');
            const fileInput = document.getElementById('file-input');
            const galleryBtn = document.getElementById('gallery-btn');
            const previewContainer = document.getElementById('preview-container');
            const previewImage = document.getElementById('preview-image');
            const previewInfo = document.getElementById('preview-info');
            const actionGroup = document.getElementById('action-group');
            const uploadBtn = document.getElementById('upload-btn');
            const compositeBtn = document.getElementById('composite-btn');
            const progressContainer = document.getElementById('progress-container');
            const progressFill = document.getElementById('progress-fill');
            const progressText = document.getElementById('progress-text');
            const resultContainer = document.getElementById('result-container');
            const resultImage = document.getElementById('result-image');
            const arButton = document.getElementById('ar-button');
            const errorMessage = document.getElementById('error-message');

            console.log('[Upload] 요소 참조:', { arButton: !!arButton });

            // 갤러리 버튼
            galleryBtn.onclick = () => {
                fileInput.removeAttribute('capture');
                fileInput.click();
            };

            // 업로드 영역 클릭
            uploadArea.onclick = () => {
                fileInput.removeAttribute('capture');
                fileInput.click();
            };

            // 파일 선택 처리
            fileInput.onchange = (e) => {
                const file = e.target.files[0];
                if (file) handleFile(file); //배경 제거 준비
            };

            // 드래그 앤 드롭
            uploadArea.ondragover = (e) => {
                e.preventDefault();
                uploadArea.classList.add('drag-over');
            };

            uploadArea.ondragleave = () => {
                uploadArea.classList.remove('drag-over');
            };

            uploadArea.ondrop = (e) => {
                e.preventDefault();
                uploadArea.classList.remove('drag-over');
                const file = e.dataTransfer.files[0];
                if (file && file.type.startsWith('image/')) {
                    handleFile(file);
                }
            };

            // AR 버튼 클릭 - onclick 사용
            arButton.onclick = function(e) {
                e.preventDefault();
                console.log('[Upload] AR 버튼 onclick 발생');
                goToAR();
            };

            // 파일 처리
            async function handleFile(file) {
                console.log('[Upload] 파일 선택:', file.name, file.size);

                if (file.size > 10 * 1024 * 1024) {
                    showError('파일 크기가 너무 큽니다 (최대 10MB)');
                    return;
                }

                if (!file.type.startsWith('image/')) {
                    showError('이미지 파일만 지원됩니다');
                    return;
                }

                hideError();

                selectedFile = file;

                // 원본 미리보기 표시
                const reader = new FileReader();
                reader.onload = (e) => {
                    previewImage.src = e.target.result;
                    previewInfo.textContent = `${file.name} (${formatFileSize(file.size)})`;
                    previewContainer.classList.add('visible');
                    actionGroup.classList.add('visible');
                };
                reader.readAsDataURL(file);
            }

            // 업로드 버튼 - 배경 제거 후 AR로 이동
            uploadBtn.onclick = () => {
                if (!selectedFile) return;
                processImage(selectedFile);
            };

            // 합성하기 버튼 - 추후 구현
            compositeBtn.onclick = () => {
                alert('준비 중입니다.');
            };

            // 테두리 정리 - 초크매트
            async function chokeAlpha(blob, amount = 2) {
                return new Promise((resolve) => {
                    const img = new Image();
                    img.onload = () => {
                        const canvas = document.createElement('canvas');
                        canvas.width = img.width;
                        canvas.height = img.height;
                        const ctx = canvas.getContext('2d');
                        ctx.drawImage(img, 0, 0);

                        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                        const data = imageData.data;
                        const width = canvas.width;
                        const height = canvas.height;

                        // 알파값 복사
                        const alphaOrig = new Uint8Array(width * height);
                        for (let i = 0; i < width * height; i++) {
                            alphaOrig[i] = data[i * 4 + 3];
                        }

                        // 주변 픽셀 중 가장 작은 알파값 사용
                        for (let pass = 0; pass < amount; pass++) {
                            const alphaCopy = new Uint8Array(alphaOrig);
                            for (let y = 1; y < height - 1; y++) {
                                for (let x = 1; x < width - 1; x++) {
                                    const idx = y * width + x;
                                    let minAlpha = alphaCopy[idx];
                                    // 3x3 커널
                                    for (let dy = -1; dy <= 1; dy++) {
                                        for (let dx = -1; dx <= 1; dx++) {
                                            const nIdx = (y + dy) * width + (x + dx);
                                            minAlpha = Math.min(minAlpha, alphaCopy[nIdx]);
                                        }
                                    }
                                    alphaOrig[idx] = minAlpha;
                                }
                            }
                        }

                        // 결과 적용
                        for (let i = 0; i < width * height; i++) {
                            data[i * 4 + 3] = alphaOrig[i];
                        }

                        ctx.putImageData(imageData, 0, 0);

                        canvas.toBlob((resultBlob) => {
                            URL.revokeObjectURL(img.src);
                            resolve(resultBlob);
                        }, 'image/png');
                    };
                    img.src = URL.createObjectURL(blob);
                });
            }

            // 배경 제거
            async function processImage(file) {
                progressContainer.classList.add('visible');
                resultContainer.classList.remove('visible');
                arButton.classList.remove('visible');
                progressFill.style.width = '0%';
                progressText.textContent = '모델 로딩 중...';

                try {
                    let rawBlob = await removeBackground(file, {
                        model: 'medium',
                        output: {
                            format: 'image/png',
                            quality: 0.9
                        },
                        progress: (key, current, total) => {
                            const percent = Math.round((current / total) * 100);
                            progressFill.style.width = (percent * 0.9) + '%'; // 90%까지
                            if (percent < 30) {
                                progressText.textContent = '모델 로딩 중...';
                            } else if (percent < 70) {
                                progressText.textContent = '배경 분석 중...';
                            } else {
                                progressText.textContent = '배경 제거 중...';
                            }
                        }
                    });

                    // 테두리 정리 (choke)
                    progressText.textContent = '테두리 정리 중...';
                    progressFill.style.width = '95%';
                    processedImageBlob = await chokeAlpha(rawBlob, 1);

                    progressFill.style.width = '100%';
                    progressText.textContent = '완료!';

                    const resultURL = URL.createObjectURL(processedImageBlob);
                    resultImage.src = resultURL;
                    resultContainer.classList.add('visible');

                    // 카메라로 보는 버튼 표시
                    arButton.classList.add('visible');
                    console.log('[Upload] 카메라 열기 버튼 표시됨, visible 클래스:', arButton.classList.contains('visible'));

                    setTimeout(() => {
                        progressContainer.classList.remove('visible');
                    }, 1000);

                    console.log('[Upload] 배경 제거 완료, processedImageBlob:', !!processedImageBlob);

                } catch (error) {
                    console.error('[Upload] 처리 실패:', error);
                    showError('배경 제거에 실패했습니다: ' + error.message);
                    progressContainer.classList.remove('visible');
                }
            }

            // AR로 이동 함수 — 서버에 업로드 후 공유 URL로 이동
            async function goToAR() {
                console.log('[Upload] goToAR 호출됨, processedImageBlob:', !!processedImageBlob);

                if (!processedImageBlob) {
                    alert('먼저 이미지를 업로드하고 배경 제거를 완료해주세요.');
                    return;
                }

                try {
                    arButton.querySelector('span').textContent = '업로드 중...';
                    arButton.style.pointerEvents = 'none';

                    const formData = new FormData();
                    formData.append('image', processedImageBlob, 'image.png');

                    const res = await fetch('/api/upload', { method: 'POST', body: formData });
                    if (!res.ok) throw new Error(`서버 오류 (${res.status})`);
                    const { id } = await res.json();

                    console.log('[Upload] 업로드 완료, id:', id);
                    window.location.href = `ar.html?id=${id}`;

                } catch (err) {
                    console.error('[Upload] AR 이동 실패:', err);
                    alert('오류가 발생했습니다: ' + err.message);
                    arButton.querySelector('span').textContent = 'AR로 보기';
                    arButton.style.pointerEvents = 'auto';
                }
            }

            // 에러 표시
            function showError(message) {
                errorMessage.textContent = message;
                errorMessage.classList.add('visible');
            }

            function hideError() {
                errorMessage.classList.remove('visible');
            }

            // 파일 크기 포맷
            function formatFileSize(bytes) {
                if (bytes < 1024) return bytes + ' B';
                if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
                return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
            }

            console.log('[Upload] 초기화 완료');
        }
