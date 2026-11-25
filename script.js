(() => {
  "use strict";

  const fileInput = document.getElementById("fileInput");
  const originalCanvas = document.getElementById("originalCanvas");
  const resultCanvas = document.getElementById("resultCanvas");
  const originalCtx = originalCanvas.getContext("2d", { willReadFrequently: true });
  const resultCtx = resultCanvas.getContext("2d", { willReadFrequently: true });
  const statusEl = document.getElementById("status");
  const buttons = [...document.querySelectorAll("[data-filter]")];

  let originalImageData = null;
  let imageWidth = 0;
  let imageHeight = 0;
  let currentObjectUrl = null;

  function setButtonsEnabled(enabled) {
    buttons.forEach(button => button.disabled = !enabled);
    document.getElementById("resetBtn").disabled = !enabled;
  }

  function clearMetrics() {
    document.getElementById("mseValue").textContent = "—";
    document.getElementById("psnrValue").textContent = "—";
    document.getElementById("activeMethod").textContent = "Belum ada";
    document.getElementById("resultTitle").textContent = "Hasil filtering";
    document.getElementById("resultInfo").textContent = "Pilih metode setelah gambar dimuat";
    document.getElementById("filterDescription").textContent = "Deskripsi metode akan muncul di sini setelah gambar dimuat.";
  }

  function resetCanvas(canvas, ctx, w = 300, h = 200) {
    canvas.width = w;
    canvas.height = h;
    ctx.clearRect(0, 0, w, h);
  }

  fileInput.addEventListener("change", () => {
    const file = fileInput.files && fileInput.files[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      statusEl.textContent = "File tidak dikenali sebagai gambar. Pilih file JPG, PNG, atau BMP.";
      fileInput.value = "";
      return;
    }

    if (currentObjectUrl) URL.revokeObjectURL(currentObjectUrl);
    currentObjectUrl = URL.createObjectURL(file);
    const img = new Image();

    img.onload = () => {
      imageWidth = img.naturalWidth;
      imageHeight = img.naturalHeight;
      originalCanvas.width = resultCanvas.width = imageWidth;
      originalCanvas.height = resultCanvas.height = imageHeight;
      originalCtx.drawImage(img, 0, 0);
      resultCtx.clearRect(0, 0, imageWidth, imageHeight);
      originalImageData = originalCtx.getImageData(0, 0, imageWidth, imageHeight);
      document.getElementById("originalInfo").textContent =
        `${imageWidth} × ${imageHeight} px · ${file.name}`;
      document.getElementById("resultInfo").textContent = "Gambar siap diproses";
      statusEl.textContent = "Gambar berhasil dimuat. Sekarang pilih metode filtering.";
      setButtonsEnabled(true);
      clearMetrics();
      URL.revokeObjectURL(currentObjectUrl);
      currentObjectUrl = null;
    };

    img.onerror = () => {
      statusEl.textContent = "Gambar gagal dibuka. Coba file gambar lain.";
      setButtonsEnabled(false);
      if (currentObjectUrl) URL.revokeObjectURL(currentObjectUrl);
      currentObjectUrl = null;
    };
    img.src = currentObjectUrl;
  });

  function clamp(value) {
    return Math.max(0, Math.min(255, Math.round(value)));
  }

  function getNeighborhood(data, x, y, channel) {
    const values = [];
    for (let ky = -1; ky <= 1; ky++) {
      for (let kx = -1; kx <= 1; kx++) {
        const px = x + kx, py = y + ky;
        if (px < 0 || px >= imageWidth || py < 0 || py >= imageHeight) continue;
        values.push(data[(py * imageWidth + px) * 4 + channel]);
      }
    }
    return values;
  }

  function applyFilter(type) {
    if (!originalImageData) return;
    const src = originalImageData.data;
    const output = new ImageData(imageWidth, imageHeight);
    const dst = output.data;
    const gaussianKernel = [[1, 2, 1], [2, 4, 2], [1, 2, 1]];
    const sharpenKernel = [[0, -1, 0], [-1, 5, -1], [0, -1, 0]];
    const laplacianKernel = [[0, -1, 0], [-1, 4, -1], [0, -1, 0]];

    for (let y = 0; y < imageHeight; y++) {
      for (let x = 0; x < imageWidth; x++) {
        const index = (y * imageWidth + x) * 4;

        for (let c = 0; c < 3; c++) {
          const values = getNeighborhood(src, x, y, c);
          let value;

          if (type === "mean") {
            value = values.reduce((sum, v) => sum + v, 0) / values.length;
          } else if (type === "median") {
            values.sort((a, b) => a - b);
            const mid = Math.floor(values.length / 2);
            value = values.length % 2 ? values[mid] : (values[mid - 1] + values[mid]) / 2;
          } else if (type === "min") {
            value = Math.min(...values);
          } else if (type === "max") {
            value = Math.max(...values);
          } else {
            const kernel = type === "gaussian" ? gaussianKernel :
                           type === "sharpen" ? sharpenKernel : laplacianKernel;
            let sum = 0, weightSum = 0;
            for (let ky = -1; ky <= 1; ky++) {
              for (let kx = -1; kx <= 1; kx++) {
                const px = x + kx, py = y + ky;
                if (px < 0 || px >= imageWidth || py < 0 || py >= imageHeight) continue;
                const weight = kernel[ky + 1][kx + 1];
                sum += src[(py * imageWidth + px) * 4 + c] * weight;
                weightSum += type === "gaussian" ? weight : 0;
              }
            }
            if (type === "gaussian") value = sum / weightSum;
            else if (type === "sharpen") value = sum;
            else value = Math.abs(sum);
          }
          dst[index + c] = clamp(value);
        }
        dst[index + 3] = src[index + 3];
      }
    }

    resultCtx.putImageData(output, 0, 0);
    const metrics = calculateMetrics(src, dst);
    const label = buttons.find(b => b.dataset.filter === type).textContent;
    document.getElementById("mseValue").textContent = metrics.mse;
    document.getElementById("psnrValue").textContent = metrics.psnr;
    document.getElementById("activeMethod").textContent = label;
    document.getElementById("resultTitle").textContent = label;
    document.getElementById("resultInfo").textContent = `${imageWidth} × ${imageHeight} px`;
    document.getElementById("filterDescription").textContent = descriptions[type];
    buttons.forEach(b => b.classList.toggle("active", b.dataset.filter === type));
    statusEl.textContent = `Metode ${label} selesai diterapkan.`;
  }

  function calculateMetrics(original, filtered) {
    let squaredError = 0;
    const pixelCount = imageWidth * imageHeight;
    for (let i = 0; i < pixelCount * 4; i += 4) {
      for (let c = 0; c < 3; c++) {
        const difference = original[i + c] - filtered[i + c];
        squaredError += difference * difference;
      }
    }
    const mse = squaredError / (pixelCount * 3);
    const psnr = mse === 0 ? Infinity : 10 * Math.log10((255 * 255) / mse);
    return {
      mse: mse.toFixed(2),
      psnr: Number.isFinite(psnr) ? `${psnr.toFixed(2)} dB` : "∞ dB"
    };
  }

  buttons.forEach(button => {
    button.addEventListener("click", () => applyFilter(button.dataset.filter));
  });

  document.getElementById("resetBtn").addEventListener("click", () => {
    if (!originalImageData) return;
    originalCtx.putImageData(originalImageData, 0, 0);
    resultCtx.putImageData(originalImageData, 0, 0);
    buttons.forEach(b => b.classList.remove("active"));
    clearMetrics();
    document.getElementById("resultTitle").textContent = "Salinan gambar asli";
    document.getElementById("resultInfo").textContent = `${imageWidth} × ${imageHeight} px`;
    document.getElementById("filterDescription").textContent = "Pilih salah satu metode untuk melihat hasilnya.";
    statusEl.textContent = "Tampilan hasil dikembalikan ke gambar asli.";
  });
})();