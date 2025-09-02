'use client';

/** Cleans up the input image by turning it into a black and white mask with a beveled edge */

export function parseLogoImage(file: File | string): Promise<{ imageData: ImageData; pngBlob: Blob }> {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');

  return new Promise((resolve, reject) => {
    if (!file || !ctx) {
      reject(new Error('Invalid file or context'));
      return;
    }

    const img = new Image();

    const canvasSize = 500;

    img.onload = function () {
      // Force SVG to load at a high fidelity size if it's an SVG
      if (typeof file === 'string' ? file.endsWith('.svg') : file.type === 'image/svg+xml') {
        img.width = canvasSize;
        img.height = canvasSize;
      }

      const ratio = img.naturalWidth / img.naturalHeight;
      let width, height;
      let padding = 60;
      if (ratio > 1) {
        width = canvasSize;
        height = Math.floor(canvasSize / ratio);
      } else {
        width = Math.floor(canvasSize * ratio);
        height = canvasSize;
      }

      canvas.width = width + 2. * padding;
      canvas.height = height + 2. * padding;

      const shapeCanvas = document.createElement('canvas');
      shapeCanvas.width = width + 2. * padding;
      shapeCanvas.height = height + 2. * padding;
      const shapeCtx = shapeCanvas.getContext('2d')!;
      shapeCtx.fillStyle = "white";
      shapeCtx.fillRect(0, 0, canvas.width, canvas.height);
      shapeCtx.filter = "grayscale(100%)";
      shapeCtx.filter = 'blur(20px)';
      shapeCtx.drawImage(img, padding, padding, width, height);
      const bigBlurData = shapeCtx.getImageData(0, 0, canvas.width, canvas.height).data;

      const outImg = ctx.createImageData(canvas.width, canvas.height);
      for (let y = 0; y < canvas.height; y++) {
        for (let x = 0; x < canvas.width; x++) {
          const idx = y * canvas.width + x;
          const px = idx * 4;
          outImg.data[px] = 255 - bigBlurData[px];
          outImg.data[px + 1] = 0;
          outImg.data[px + 2] = 0;
          outImg.data[px + 3] = 255;
        }
      }
      ctx.putImageData(outImg, 0, 0);
      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error('Failed to create PNG blob'));
          return;
        }
        resolve({
          imageData: outImg,
          pngBlob: blob,
        });
      }, 'image/png');
    };

    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = typeof file === 'string' ? file : URL.createObjectURL(file);
  });
}
