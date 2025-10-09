'use client';

/** Cleans up the input image by turning it into a black and white mask with a beveled edge */

import { parseLogoImage2 } from './parse-logo-image-optimized';

// Configuration for Poisson solver
export const POISSON_CONFIG = {
  method: 'gauss-seidel' as 'gauss-seidel' | 'jacobi', // 'gauss-seidel' is ~2x faster
  measurePerformance: false, // Set to true to log performance metrics
  adaptiveConvergence: false, // Use convergence threshold instead of fixed iterations
  convergenceThreshold: 1e-4, // Stop when residual falls below this (only if adaptiveConvergence=true)
  maxIterations: 500, // Maximum iterations for adaptive mode
  useLargeImageOptimizations: true, // Enable for images >1000px (uses TypedArrays, sparse processing)
  autoOptimizeThreshold: 0, // Always use optimized version (set to 0 to use for all sizes)
  gradientProportion: 0.15, // Gradient width as proportion of image size (0.1 = 10%, 0.15 = 15%)
  referenceSize: 500, // Reference image size where the gradient looks correct
};

export function parseLogoImage(file: File | string): Promise<{ imageData: ImageData; pngBlob: Blob }> {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');

  return new Promise((resolve, reject) => {
    if (!file || !ctx) {
      reject(new Error('Invalid file or context'));
      return;
    }

    const img = new Image();
    img.onload = function () {
      const MAX_SIZE = 1000;
      const MIN_SIZE = 500;
      let width = img.naturalWidth;
      let height = img.naturalHeight;

      // Force SVG to load at a high fidelity size if it's an SVG
      if (typeof file === 'string' ? file.endsWith('.svg') : file.type === 'image/svg+xml') {
        // Scale SVG to 1000px max dimension while preserving aspect ratio
        const aspectRatio = width / height;

        if (width > height) {
          width = MAX_SIZE;
          height = MAX_SIZE / aspectRatio;
        } else {
          height = MAX_SIZE;
          width = MAX_SIZE * aspectRatio;
        }

        img.width = width;
        img.height = height;
      }

      // Always use the optimized version for better performance
      if (
        POISSON_CONFIG.useLargeImageOptimizations &&
        (width > POISSON_CONFIG.autoOptimizeThreshold || height > POISSON_CONFIG.autoOptimizeThreshold)
      ) {
        // Delegate to optimized version (always used now for all sizes)
        parseLogoImage2(file).then(resolve).catch(reject);
        return;
      }

      // Calculate new dimensions if image is too large or too small
      if (width > MAX_SIZE || height > MAX_SIZE || width < MIN_SIZE || height < MIN_SIZE) {
        if (width > height) {
          if (width > MAX_SIZE) {
            height = Math.round((height * MAX_SIZE) / width);
            width = MAX_SIZE;
          } else if (width < MIN_SIZE) {
            height = Math.round((height * MIN_SIZE) / width);
            width = MIN_SIZE;
          }
        } else {
          if (height > MAX_SIZE) {
            width = Math.round((width * MAX_SIZE) / height);
            height = MAX_SIZE;
          } else if (height < MIN_SIZE) {
            width = Math.round((width * MIN_SIZE) / height);
            height = MIN_SIZE;
          }
        }
      }

      canvas.width = width;
      canvas.height = height;

      // Draw the user image on an offscreen canvas.
      const shapeCanvas = document.createElement('canvas');
      shapeCanvas.width = width;
      shapeCanvas.height = height;
      const shapeCtx = shapeCanvas.getContext('2d')!;
      shapeCtx.drawImage(img, 0, 0, width, height);

      // 1) Build the inside/outside mask:
      // Non-shape pixels: pure white (255,255,255,255) or fully transparent.
      // Everything else is part of a shape.
      const shapeImageData = shapeCtx.getImageData(0, 0, width, height);
      const data = shapeImageData.data;
      const shapeMask = new Array(width * height).fill(false);
      for (var y = 0; y < height; y++) {
        for (var x = 0; x < width; x++) {
          var idx4 = (y * width + x) * 4;
          var r = data[idx4];
          var g = data[idx4 + 1];
          var b = data[idx4 + 2];
          var a = data[idx4 + 3];
          if ((r === 255 && g === 255 && b === 255 && a === 255) || a === 0) {
            shapeMask[y * width + x] = false;
          } else {
            shapeMask[y * width + x] = true;
          }
        }
      }

      function inside(x: number, y: number) {
        if (x < 0 || x >= width || y < 0 || y >= height) return false;
        return shapeMask[y * width + x];
      }

      // 2) Identify boundary (pixels that have at least one non-shape neighbor)
      var boundaryMask = new Array(width * height).fill(false);
      for (var y = 0; y < height; y++) {
        for (var x = 0; x < width; x++) {
          var idx = y * width + x;
          if (!shapeMask[idx]) continue;
          var isBoundary = false;
          for (var ny = y - 1; ny <= y + 1 && !isBoundary; ny++) {
            for (var nx = x - 1; nx <= x + 1 && !isBoundary; nx++) {
              if (!inside(nx, ny)) {
                isBoundary = true;
              }
            }
          }
          if (isBoundary) {
            boundaryMask[idx] = true;
          }
        }
      }

      // 3) Poisson solve: Δu = -C (i.e. u_xx + u_yy = C), with u=0 at the boundary.
      // Scale the diffusion based on image size to maintain consistent proportions
      const REFERENCE_SIZE = POISSON_CONFIG.referenceSize;
      const TARGET_GRADIENT_RATIO = POISSON_CONFIG.gradientProportion;
      const minDimension = Math.min(width, height);
      const scaleFactor = minDimension / REFERENCE_SIZE;

      // IMPORTANT: Gradient width scales with sqrt(iterations) in Poisson diffusion
      // To get 2x wider gradient, we need 4x iterations (2^2 = 4)
      const USE_GAUSS_SEIDEL = POISSON_CONFIG.method === 'gauss-seidel';

      // Recalibrated base: 300 iterations gives ~10% gradient at 500px
      const baseIterations = USE_GAUSS_SEIDEL ? 300 : 600;

      // Scale iterations quadratically to maintain proportional gradient
      const iterationScale = scaleFactor * scaleFactor * (TARGET_GRADIENT_RATIO / 0.1); // Normalize to 0.1 base
      const scaledIterations = Math.round(baseIterations * iterationScale);

      // Higher cap for very large images
      const MAX_ITERATIONS = 5000;
      const ITERATIONS = POISSON_CONFIG.adaptiveConvergence
        ? POISSON_CONFIG.maxIterations
        : Math.min(scaledIterations, MAX_ITERATIONS);

      // Keep C constant - only iterations control gradient spread
      var C = 0.01;

      // Performance measurement
      const startTime = POISSON_CONFIG.measurePerformance ? performance.now() : 0;

      // For adaptive convergence checking
      let actualIterations = ITERATIONS;
      let finalResidual = 0;

      var u = new Float32Array(width * height).fill(0);
      var newU: Float32Array | null = null;

      // Only allocate second array if using Jacobi
      if (!USE_GAUSS_SEIDEL) {
        newU = new Float32Array(width * height).fill(0);
      }

      function getU(x: number, y: number, arr: Float32Array) {
        if (x < 0 || x >= width || y < 0 || y >= height) return 0;
        if (!shapeMask[y * width + x]) return 0;
        return arr[y * width + x];
      }

      // Calculate residual for convergence checking
      function calculateResidual(): number {
        if (!POISSON_CONFIG.adaptiveConvergence) return 0;

        let residual = 0;
        let count = 0;
        for (let y = 1; y < height - 1; y++) {
          for (let x = 1; x < width - 1; x++) {
            const idx = y * width + x;
            if (!shapeMask[idx] || boundaryMask[idx]) continue;

            const laplacian =
              getU(x + 1, y, u) + getU(x - 1, y, u) + getU(x, y + 1, u) + getU(x, y - 1, u) - 4 * u[idx];
            const error = Math.abs(laplacian - C);
            residual += error * error;
            count++;
          }
        }
        return count > 0 ? Math.sqrt(residual / count) : 0;
      }

      if (USE_GAUSS_SEIDEL) {
        // Gauss-Seidel method: Update in-place, using immediately computed values
        // This converges faster and uses less memory
        for (var iter = 0; iter < ITERATIONS; iter++) {
          // Red-Black ordering for better parallelization potential and stability
          // First pass: red squares (x + y) % 2 == 0
          for (var y = 0; y < height; y++) {
            for (var x = y % 2; x < width; x += 2) {
              var idx = y * width + x;
              if (!shapeMask[idx] || boundaryMask[idx]) {
                u[idx] = 0;
                continue;
              }
              var sumN = getU(x + 1, y, u) + getU(x - 1, y, u) + getU(x, y + 1, u) + getU(x, y - 1, u);
              u[idx] = (C + sumN) / 4;
            }
          }
          // Second pass: black squares (x + y) % 2 == 1
          for (var y = 0; y < height; y++) {
            for (var x = (y + 1) % 2; x < width; x += 2) {
              var idx = y * width + x;
              if (!shapeMask[idx] || boundaryMask[idx]) {
                u[idx] = 0;
                continue;
              }
              var sumN = getU(x + 1, y, u) + getU(x - 1, y, u) + getU(x, y + 1, u) + getU(x, y - 1, u);
              u[idx] = (C + sumN) / 4;
            }
          }

          // Check convergence every 10 iterations if adaptive mode is enabled
          if (POISSON_CONFIG.adaptiveConvergence && iter > 0 && iter % 10 === 0) {
            finalResidual = calculateResidual();
            if (finalResidual < POISSON_CONFIG.convergenceThreshold) {
              actualIterations = iter + 1;
              break;
            }
          }
        }
      } else {
        // Original Jacobi method: Update all values simultaneously using old values
        for (var iter = 0; iter < ITERATIONS; iter++) {
          for (var y = 0; y < height; y++) {
            for (var x = 0; x < width; x++) {
              var idx = y * width + x;
              if (!shapeMask[idx] || boundaryMask[idx]) {
                newU![idx] = 0;
                continue;
              }
              var sumN = getU(x + 1, y, u) + getU(x - 1, y, u) + getU(x, y + 1, u) + getU(x, y - 1, u);
              newU![idx] = (C + sumN) / 4;
            }
          }
          // Swap u with newU
          for (var i = 0; i < width * height; i++) {
            u[i] = newU![i];
          }

          // Check convergence every 10 iterations if adaptive mode is enabled
          if (POISSON_CONFIG.adaptiveConvergence && iter > 0 && iter % 10 === 0) {
            finalResidual = calculateResidual();
            if (finalResidual < POISSON_CONFIG.convergenceThreshold) {
              actualIterations = iter + 1;
              break;
            }
          }
        }
      }

      // Log performance metrics if enabled
      if (POISSON_CONFIG.measurePerformance) {
        const elapsed = performance.now() - startTime;
        const pixelCount = shapeMask.filter(Boolean).length;
        const iterationsUsed = POISSON_CONFIG.adaptiveConvergence ? actualIterations : ITERATIONS;

        console.log(`[Poisson Solver Performance]`);
        console.log(`  Image size: ${width}×${height}`);
        console.log(`  Scale factor: ${scaleFactor.toFixed(2)}× (vs ${REFERENCE_SIZE}px reference)`);
        console.log(
          `  Gradient proportion: ${TARGET_GRADIENT_RATIO} (${(TARGET_GRADIENT_RATIO * 100).toFixed(0)}% of image size)`
        );
        console.log(
          `  Scaled iterations: ${ITERATIONS} (base: ${baseIterations}, requested: ${scaledIterations}, scale: ${iterationScale.toFixed(2)}×)`
        );
        console.log(`  Method: ${POISSON_CONFIG.method}`);
        if (POISSON_CONFIG.adaptiveConvergence) {
          console.log(`  Adaptive convergence: YES (threshold: ${POISSON_CONFIG.convergenceThreshold})`);
          console.log(`  Iterations: ${actualIterations} / ${ITERATIONS} max`);
          console.log(`  Final residual: ${finalResidual.toExponential(2)}`);
        } else {
          console.log(`  Iterations: ${ITERATIONS} (fixed)`);
        }
        console.log(`  Time: ${elapsed.toFixed(2)}ms`);
        console.log(`  Image size: ${width}x${height} (${pixelCount} shape pixels)`);
        console.log(`  Speed: ${((iterationsUsed * pixelCount) / (elapsed * 1000)).toFixed(2)} Mpixels/sec`);
        console.log(
          `  Memory: ${USE_GAUSS_SEIDEL ? '1 array' : '2 arrays'} (${((u.length * 4) / 1024).toFixed(1)}KB${USE_GAUSS_SEIDEL ? '' : ' x2'})`
        );
      }

      // 4) Normalize the solution and apply a nonlinear remap.
      var maxVal = 0;
      for (var i = 0; i < width * height; i++) {
        if (u[i] > maxVal) maxVal = u[i];
      }
      const alpha = 1.0; // Adjust for contrast.
      const outImg = ctx.createImageData(width, height);

      for (var y = 0; y < height; y++) {
        for (var x = 0; x < width; x++) {
          var idx = y * width + x;
          var px = idx * 4;
          if (!shapeMask[idx]) {
            outImg.data[px] = 255;
            outImg.data[px + 1] = 255;
            outImg.data[px + 2] = 255;
            outImg.data[px + 3] = 255;
          } else {
            const raw = u[idx] / maxVal;
            const remapped = Math.pow(raw, alpha);
            const gray = 255 * (1 - remapped);
            outImg.data[px] = gray;
            outImg.data[px + 1] = gray;
            outImg.data[px + 2] = gray;
            outImg.data[px + 3] = 255;
          }
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
