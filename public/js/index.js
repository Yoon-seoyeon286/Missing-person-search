//@imgly/background-removal
import { removeBackground } from 'https://cdn.jsdelivr.net/npm/@imgly/background-removal@1.5.1/+esm';

        // 처리된 이미지 Blob
        let processedImageBlob = null;

        // DOM 로드 후 실행
        document.addEventListener('DOMContentLoaded', () => {
            console.log('[Upload] DOM 로드 완료');
            initApp();
        });

        //초기화!
        function initApp() {
            // 요소 참조
            const fileInput = document.getElementById('file-input');
            const uploadFullBtn = document.getElementById('upload-full-btn');
            const previewContainer = document.getElementById('preview-container');
            const previewImage = document.getElementById('preview-image');
            const previewInfo = document.getElementById('preview-info');
            const progressContainer = document.getElementById('progress-container');
            const progressFill = document.getElementById('progress-fill');
            const progressText = document.getElementById('progress-text');
            const resultContainer = document.getElementById('result-container');
            const resultImage = document.getElementById('result-image');
            const resultLinks = document.getElementById('result-links');
            const btnArLink   = document.getElementById('btn-ar-link');
            const btnCopyIdx  = document.getElementById('btn-copy-idx');
            const toast       = document.getElementById('toast');
            const errorMessage = document.getElementById('error-message');

            // 합성하기 버튼
            document.getElementById('composite-btn').onclick = () => {
                window.location.href = 'composite.html';
            };

            // 전신 사진 올리기 버튼
            uploadFullBtn.onclick = () => {
                fileInput.removeAttribute('capture');
                fileInput.click();
            };

            // 파일 선택 → 미리보기 + 자동 배경 제거
            fileInput.onchange = (e) => {
                const file = e.target.files[0];
                if (file) handleFile(file);
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

                // 원본 미리보기 표시
                const reader = new FileReader();
                reader.onload = (e) => {
                    previewImage.src = e.target.result;
                    previewInfo.textContent = `${file.name} (${formatFileSize(file.size)})`;
                    previewContainer.classList.add('visible');
                };
                reader.readAsDataURL(file);

                // 배경 제거 바로 시작
                await processImage(file);
            }

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
                resultLinks.classList.remove('visible');
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

                    const resultURL = URL.createObjectURL(processedImageBlob);
                    resultImage.src = resultURL;
                    resultContainer.classList.add('visible');

                    // 자동 업로드 → 링크 생성
                    await generateLink();

                } catch (error) {
                    console.error('[Upload] 처리 실패:', error);
                    showError('배경 제거에 실패했습니다: ' + error.message);
                    progressContainer.classList.remove('visible');
                }
            }

            // 업로드 후 링크 생성
            async function generateLink() {
                progressFill.style.width = '100%';
                progressText.textContent = '링크 생성 중...';

                try {
                    const formData = new FormData();
                    formData.append('image', processedImageBlob, 'image.png');

                    const res = await fetch('/api/upload', { method: 'POST', body: formData });
                    if (!res.ok) throw new Error(`서버 오류 (${res.status})`);
                    const { id } = await res.json();

                    const arUrl = `${location.origin}/ar.html?id=${id}`;
                    btnArLink.href = arUrl;
                    btnCopyIdx.onclick = () => {
                        navigator.clipboard.writeText(arUrl).then(() => {
                            toast.classList.add('show');
                            setTimeout(() => toast.classList.remove('show'), 2000);
                        });
                    };
                    resultLinks.classList.add('visible');

                    setTimeout(() => progressContainer.classList.remove('visible'), 800);

                } catch (err) {
                    console.error('[Upload] 링크 생성 실패:', err);
                    showError('링크 생성에 실패했습니다: ' + err.message);
                    progressContainer.classList.remove('visible');
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
