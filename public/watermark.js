/**
 * Watermark Utility - 강화판 (logo.png 사용)
 */
window.Watermark = {
    apply: function (canvas, logoUrl, options = {}) {
        return new Promise((resolve) => {
            const src = logoUrl || 'logo.png';
            const defaults = {
                opacity: 0.9,
                margin: 50,
                sizeRatio: 0.25
            };
            const config = { ...defaults, ...options };
            const ctx = canvas.getContext('2d');

            if (!ctx) {
                resolve(canvas);
                return;
            }

            // === [초강력 디버그 표식] ===
            // 왼쪽 상단에 큰 핫핑크 사각형
            const debugSize = Math.min(canvas.width, canvas.height) * 0.1;
            ctx.fillStyle = '#FF00FF';
            ctx.fillRect(20, 20, debugSize, debugSize);

            const logo = new Image();
            logo.crossOrigin = "anonymous";

            logo.onload = () => {
                const logoSize = Math.min(canvas.width, canvas.height) * config.sizeRatio;
                const x = canvas.width - logoSize - config.margin;
                const y = canvas.height - logoSize - config.margin;

                ctx.save();
                ctx.globalAlpha = config.opacity;
                ctx.drawImage(logo, x, y, logoSize, logoSize);
                ctx.restore();

                resolve(canvas);
            };

            logo.onerror = () => {
                ctx.fillStyle = 'red';
                const s = 100;
                ctx.fillRect(canvas.width - s - 50, canvas.height - s - 50, s, s);
                resolve(canvas);
            };

            logo.src = src + '?t=' + Date.now();
        });
    }
};
