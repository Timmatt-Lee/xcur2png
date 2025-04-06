// load using import
import { glob } from "glob";
import fs from "fs/promises";
import { createWriteStream } from "fs";
import { createCanvas, createImageData } from "canvas"; // Correct import
import path from "path";
import GIFEncoder from "gifencoder";
import sharp from "sharp";

// Run the main processing function
processFiles().catch((err) => {
  console.error("An unexpected error occurred in processFiles:", err);
});

async function processFiles() {
  // Add "type": "module" to package.json to fix warning
  const paths = await glob("cursor/**/*", {
    ignore: ["node_modules/**", "**/*.{tar.gz,theme,png,gif}"],
  });

  const TARGET_FRAME_COUNT = 24; // Set the maximum number of frames for strips

  for (const filePath of paths) {
    console.log(`\n--- Processing File: ${filePath} ---`);
    let framesBySize = {}; // Reset for each file

    try {
      const dataBuffer = await fs.readFile(filePath);
      const arrayBuffer = dataBuffer.buffer.slice(
        dataBuffer.byteOffset,
        dataBuffer.byteOffset + dataBuffer.byteLength
      );
      const dv = new DataView(arrayBuffer);

      // --- Validate Header & TOC ---
      if (dv.byteLength < 16 || dv.getUint32(0, false) !== 0x58637572) {
        console.warn(
          `Skipping ${filePath}: Not a valid Xcursor file or too small.`
        );
        continue;
      }
      const ntoc = dv.getUint32(12, true);
      const expectedMinSize = 16 + ntoc * 12;
      if (dv.byteLength < expectedMinSize) {
        console.error(
          `Error: File buffer too small (${dv.byteLength} bytes) for TOC in ${filePath}. Declared ${ntoc} entries, expected >= ${expectedMinSize} bytes. Skipping file.`
        );
        continue;
      }
      console.debug(` -> Header OK. TOC Entries: ${ntoc}`);

      // --- Loop: Extract and GROUP frames ---
      console.debug(" -> Starting frame extraction and grouping loop...");
      for (let i = 0; i < ntoc; i++) {
        const tocOffset = 16 + i * 12;
        if (tocOffset + 12 > dv.byteLength) {
          console.error(
            `    TOC Entry ${i}: Read offset ${
              tocOffset + 12
            } exceeds file length ${dv.byteLength}. Stopping TOC read.`
          );
          break;
        }
        const type = dv.getUint32(tocOffset, true);
        const position = dv.getUint32(tocOffset + 8, true);

        if (type === 0xfffd0002) {
          // Image chunk
          const chunkHeaderSize = 36;
          if (position + chunkHeaderSize > dv.byteLength) {
            console.error(
              `    Chunk ${i}: Invalid chunk position ${position}. Header would exceed file length ${dv.byteLength}. Skipping chunk.`
            );
            continue;
          }
          const width = dv.getInt32(position + 16, true);
          const height = dv.getInt32(position + 20, true);
          if (width <= 0 || height <= 0) {
            console.warn(
              `      Chunk ${i}: Invalid dimensions (${width}x${height}). Skipping chunk.`
            );
            continue;
          }
          const xhot = dv.getInt32(position + 24, true);
          const yhot = dv.getInt32(position + 28, true);
          const delay = dv.getUint32(position + 32, true);
          const pixelDataStartOffset = position + chunkHeaderSize;
          const expectedPixelDataLength = width * height * 4;
          if (pixelDataStartOffset + expectedPixelDataLength > dv.byteLength) {
            console.error(
              `      Chunk ${i}: Calculated pixel data end (${
                pixelDataStartOffset + expectedPixelDataLength
              }) exceeds file length (${dv.byteLength}). Skipping chunk.`
            );
            continue;
          }
          console.info(
            `      Chunk ${i}: Found Image ${width}x${height}, Delay: ${delay}, Data @ ${pixelDataStartOffset}`
          );

          const rgbaData = extractFrameRgbaData(
            dv,
            width,
            height,
            pixelDataStartOffset
          );

          if (rgbaData) {
            console.log(
              `      Extraction SUCCESS for frame index ${i} (${width}x${height}).`
            );
            const currentFrame = {
              width,
              height,
              xhot,
              yhot,
              delay,
              data: rgbaData,
            };
            const sizeKey = `${width}x${height}`;
            if (!framesBySize[sizeKey]) {
              framesBySize[sizeKey] = [];
              console.log(`      ---> Found first frame for size ${sizeKey}`);
            }
            framesBySize[sizeKey].push(currentFrame);
            console.log(
              `      ---> Added frame index ${i} to size group ${sizeKey} (Total in group: ${framesBySize[sizeKey].length})`
            );
          } else {
            console.error(
              `      Extraction FAILED for frame index ${i} (${width}x${height}). Frame not added.`
            );
          }
        } // end if image chunk
      } // --- End of TOC loop ---
      console.debug(" -> Finished frame extraction loop.");

      // --- Decision Block: Process each size group ---
      const sizeGroups = Object.keys(framesBySize);
      console.debug(
        ` -> Found ${sizeGroups.length} size group(s): ${sizeGroups.join(", ")}`
      );

      if (sizeGroups.length === 0) {
        console.log(
          ` -> No valid image frames found in ${filePath}. No output generated.`
        );
      } else {
        for (const sizeKey of sizeGroups) {
          const originalFrames = framesBySize[sizeKey]; // All frames for this size
          const [widthStr, heightStr] = sizeKey.split("x");
          const width = parseInt(widthStr, 10);
          const height = parseInt(heightStr, 10);
          if (isNaN(width) || isNaN(height) || width <= 0 || height <= 0) {
            console.error(
              ` -> Invalid size key encountered: ${sizeKey}. Skipping group.`
            );
            continue;
          }

          const originalFrameCount = originalFrames.length;
          console.log(
            ` -> Processing size group: ${sizeKey} with ${originalFrameCount} frame(s).`
          );

          if (originalFrameCount === 1) {
            console.log(`    Saving as single PNG.`);
            await saveFrameAsPng(
              originalFrames[0].data,
              width,
              height,
              filePath
            );
          } else {
            // originalFrameCount > 1
            let framesToUse = originalFrames; // Default to using all frames
            let actualFrameCount = originalFrameCount;

            // --- Apply Frame Limit Logic ---
            if (originalFrameCount > TARGET_FRAME_COUNT) {
              console.warn(
                `    Original frame count (${originalFrameCount}) exceeds target (${TARGET_FRAME_COUNT}). Sampling frames evenly.`
              );
              actualFrameCount = TARGET_FRAME_COUNT;
              framesToUse = []; // Start with an empty array for selected frames
              for (let k = 0; k < actualFrameCount; k++) {
                // Calculate the index from the original sequence
                let originalIndex = Math.floor(
                  (k * originalFrameCount) / actualFrameCount
                );
                // Ensure the calculated index is within bounds
                originalIndex = Math.min(originalIndex, originalFrameCount - 1);
                framesToUse.push(originalFrames[originalIndex]); // Add the selected frame
              }
              console.log(
                `    Sampled ${framesToUse.length} frames to use for strip.`
              );
            } else {
              console.log(
                `    Using all ${originalFrameCount} frames for strip (within limit).`
              );
            }
            // --- End Frame Limit Logic ---

            console.log(
              `    Attempting to save as PNG strip (${actualFrameCount} frames).`
            );
            // Call createPngStrip with the potentially reduced 'framesToUse' array
            // createPngStrip handles the actual drawing based on the array length
            await createPngStrip(framesToUse, width, height, filePath);
          }
        }
      }
    } catch (err) {
      console.error(`Error processing file ${filePath}:`, err);
    }
  } // --- End of File loop ---
  console.log("\n--- All Files Processed ---");
}

/**
 * Extracts RGBA pixel data for a single frame from the DataView.
 *
 * @param {DataView} dv - The DataView containing the cursor file data.
 * @param {number} width - The width of the frame.
 * @param {number} height - The height of the frame.
 * @param {number} startOffset - The starting byte offset within the DataView for this frame's BGRA pixel data.
 * @returns {Buffer | null} A Buffer containing RGBA pixel data, or null on error.
 */
function extractFrameRgbaData(dv, width, height, startOffset) {
  if (width <= 0 || height <= 0) {
    console.error(
      `extractFrameRgbaData: Invalid dimensions (${width}x${height})`
    );
    return null;
  }
  const expectedDataLength = width * height * 4;
  const rgbaBuffer = Buffer.alloc(expectedDataLength); // Allocate buffer for RGBA data
  let currentReadPos = startOffset;

  // Check if data is potentially within bounds BEFORE looping
  if (dv.byteLength < currentReadPos + expectedDataLength) {
    console.warn(
      `Warning: DataView buffer might be too small for frame (${width}x${height}). Expected ${expectedDataLength} bytes starting from offset ${startOffset}, buffer size is ${dv.byteLength}. Attempting to read anyway.`
    );
  }

  try {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        // Read BGRA from DataView
        if (currentReadPos + 3 >= dv.byteLength) {
          throw new Error(
            `Reached end of DataView buffer unexpectedly while reading pixel (${x}, ${y}). Offset: ${currentReadPos}`
          );
        }
        const b = dv.getUint8(currentReadPos++);
        const g = dv.getUint8(currentReadPos++);
        const r = dv.getUint8(currentReadPos++);
        const a = dv.getUint8(currentReadPos++);

        // Calculate the index in the RGBA buffer
        const index = (y * width + x) * 4;

        // Write RGBA to the Buffer
        rgbaBuffer[index] = r;
        rgbaBuffer[index + 1] = g;
        rgbaBuffer[index + 2] = b;
        rgbaBuffer[index + 3] = a;
      }
    }
    return rgbaBuffer;
  } catch (err) {
    console.error(
      `Error extracting pixel data for frame (${width}x${height}):`,
      err
    );
    return null;
  }
}

/**
 * Saves a single frame as a PNG file.
 *
 * @param {Buffer} rgbaData - Buffer containing raw RGBA pixel data.
 * @param {number} width - The width of the image.
 * @param {number} height - The height of the image.
 * @param {string} originalFilePath - The path to the original file (used for naming).
 */
async function saveFrameAsPng(rgbaData, width, height, originalFilePath) {
  try {
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext("2d");
    // Create ImageData from the raw RGBA data
    // Note: Need Uint8ClampedArray for createImageData
    const clampedRgbaData = Uint8ClampedArray.from(rgbaData);
    const imgData = createImageData(clampedRgbaData, width, height);

    // Put the image data onto the canvas
    ctx.putImageData(imgData, 0, 0);

    // Prepare output path
    const parsedPath = path.parse(originalFilePath);
    const sizeSuffix = `_${width}`; // Or `${width}x${height}`
    const outputFilename = `${parsedPath.name}${sizeSuffix}.png`;
    const outputPath = path.join(parsedPath.dir, outputFilename);

    // Save the canvas to PNG
    const pngBuffer = canvas.toBuffer("image/png");
    await fs.writeFile(outputPath, pngBuffer);
    console.log(`Single frame saved: ${outputPath}`);
  } catch (err) {
    console.error(`Error saving frame as PNG (${originalFilePath}):`, err);
  }
}

// --- NEW HELPER FUNCTION: Pad Frame ---
/**
 * Pads a single frame's RGBA buffer to maxWidth x maxHeight using sharp.
 * @param {object} frame - Frame object { width, height, data }
 * @param {number} maxWidth - Target width
 * @param {number} maxHeight - Target height
 * @returns {Promise<Buffer|null>} Buffer of the padded RGBA data, or null on error.
 */
async function padFrame(frame, maxWidth, maxHeight) {
  try {
    if (!frame || !frame.data || !frame.width || !frame.height) {
      throw new Error("Invalid frame object received in padFrame");
    }
    // If already max size, return original buffer (no padding needed)
    if (frame.width === maxWidth && frame.height === maxHeight) {
      console.debug(
        `    Frame (${frame.width}x${frame.height}) already max size. No padding needed.`
      );
      return frame.data;
    }
    console.debug(
      `    Padding frame (${frame.width}x${frame.height}) to ${maxWidth}x${maxHeight}...`
    );

    const paddedBuffer = await sharp(frame.data, {
      raw: { width: frame.width, height: frame.height, channels: 4 },
    })
      .extend({
        // Pad with transparency
        top: 0, // Place original at top
        left: 0, // Place original at left
        // Calculate padding needed for bottom and right edge
        bottom: maxHeight - frame.height,
        right: maxWidth - frame.width,
        background: { r: 0, g: 0, b: 0, alpha: 0 }, // Transparent padding
      })
      .raw() // Ensure output is raw RGBA pixel data
      .toBuffer();

    // Verify output buffer size
    const expectedSize = maxWidth * maxHeight * 4;
    if (paddedBuffer.length !== expectedSize) {
      throw new Error(
        `Padded buffer size mismatch. Expected ${expectedSize}, got ${paddedBuffer.length}`
      );
    }
    console.debug(
      `    Padding successful for frame (${frame.width}x${frame.height}).`
    );
    return paddedBuffer;
  } catch (err) {
    console.error(
      `Error padding frame (${frame.width}x${frame.height} to ${maxWidth}x${maxHeight}):`,
      err
    );
    return null; // Return null on error
  }
}

/**
 * Creates an animated GIF using gifencoder for frames of a single size.
 * @param {Array<object>} frames - Array of frame objects (all same size) { width, height, delay, data (RGBA Buffer) }
 * @param {number} width - The width of the frames in this group.
 * @param {number} height - The height of the frames in this group.
 * @param {string} originalFilePath - Path to the original cursor file for naming.
 */
async function createAnimatedGifForSize(
  frames,
  width,
  height,
  originalFilePath
) {
  if (!frames || frames.length <= 1) {
    console.error(
      `[${width}x${height}] Not enough frames provided for GIFEncoder creation (need > 1).`
    );
    return;
  }
  if (width <= 0 || height <= 0) {
    console.error(
      `[${width}x${height}] Invalid dimensions for GIFEncoder creation.`
    );
    return;
  }
  console.debug(
    ` -> Creating ${width}x${height} GIF with ${frames.length} frames...`
  );

  // --- Prepare Outputs ---
  const delays = frames.map((f) => f.delay || 100); // Use default delay if 0
  const parsedPath = path.parse(originalFilePath);
  // Name includes the specific size for this GIF
  const outputFilename = `${parsedPath.name}_${width}x${height}.gif`;
  const outputPath = path.join(parsedPath.dir, outputFilename);

  try {
    // --- Setup GIFEncoder ---
    const encoder = new GIFEncoder(width, height); // Use specific size from group
    const stream = encoder
      .createReadStream()
      .pipe(createWriteStream(outputPath));

    encoder.start();
    encoder.setRepeat(0); // 0 = loop forever
    // encoder.setQuality(10); // Optional

    // --- Transparency attempt ---
    // Option 1 (Simplest): Hope addFrame respects RGBA alpha (if alpha=0 is in data)
    // Option 2 (Maybe): Try setting transparent color if background is known (e.g., black)
    encoder.setTransparent(0x000000); // If background is known to be black & should be transparent

    console.debug(
      ` -> Encoding ${frames.length} frames (${width}x${height}) with GIFEncoder...`
    );
    // --- Add Frames ---
    for (let i = 0; i < frames.length; i++) {
      if (!frames[i] || !frames[i].data) {
        console.error(
          `    [${width}x${height}] Skipping frame ${i} because its buffer is missing.`
        );
        continue; // Skip this frame
      }
      encoder.setDelay(delays[i]);
      // Add the original RGBA buffer for this size (no padding needed)
      encoder.addFrame(frames[i].data);
      console.debug(`    Encoded frame ${i}, delay ${delays[i]}`);
    }

    encoder.finish(); // Finish encoding
    console.debug(` -> GIFEncoder finished.`);

    // Wait for the file stream to finish writing
    await new Promise((resolve, reject) => {
      stream.on("finish", resolve);
      stream.on("error", reject); // Reject promise on stream error
    });

    console.log(
      `GIFEncoder GIF saved: ${outputPath} (${frames.length} frames, ${width}x${height})`
    );
  } catch (err) {
    console.error(
      `Error creating ${width}x${height} GIF with GIFEncoder for ${outputPath}:`,
      err
    );
    if (frames && frames.length > 0) {
      console.error("First frame details (if helpful):", {
        width: frames[0].width,
        height: frames[0].height,
        delay: frames[0].delay,
        dataLength: frames[0].data?.length,
        dataType: frames[0].data?.constructor.name,
      });
    }
  }
}

// --- NEW FUNCTION: Create PNG Strip ---
/**
 * Creates a vertical PNG strip containing all frames for a specific size.
 * @param {Array<object>} frames - Array of frame objects (all same size) { data (RGBA Buffer) }
 * @param {number} width - The width of the frames.
 * @param {number} height - The height of the frames.
 * @param {string} originalFilePath - Path to the original cursor file for naming.
 */
async function createPngStrip(frames, width, height, originalFilePath) {
  if (!frames || frames.length <= 1) {
    console.warn(
      `[${width}x${height}] Skipping PNG strip creation: Need more than 1 frame.`
    );
    return;
  }
  if (width <= 0 || height <= 0) {
    console.error(
      `[${width}x${height}] Invalid dimensions for PNG strip creation.`
    );
    return;
  }

  const frameCount = frames.length;
  const stripWidth = width;
  const stripHeight = height * frameCount;
  console.debug(
    ` -> Creating ${stripWidth}x${stripHeight} PNG strip with ${frameCount} frames...`
  );

  // --- Prepare Output Path ---
  const parsedPath = path.parse(originalFilePath);
  // Append "_strip" to filename
  const outputFilename = `${parsedPath.name}_${width}x${height}_strip.png`;
  const outputPath = path.join(parsedPath.dir, outputFilename);

  try {
    // --- Create Canvas ---
    const stripCanvas = createCanvas(stripWidth, stripHeight);
    const ctx = stripCanvas.getContext("2d");

    // --- Draw each frame onto the canvas ---
    for (let i = 0; i < frameCount; i++) {
      const frame = frames[i];
      if (!frame || !frame.data) {
        console.error(`    Skipping frame ${i} in strip: Missing data.`);
        continue; // Skip if data is missing
      }

      // Verify buffer size (optional but good)
      const expectedBufferSize = width * height * 4;
      if (frame.data.length !== expectedBufferSize) {
        console.error(
          `    Skipping frame ${i} in strip: Incorrect buffer size. Expected ${expectedBufferSize}, got ${frame.data.length}`
        );
        continue;
      }

      // Create ImageData object for the current frame
      // NOTE: createImageData expects a Uint8ClampedArray, not a Buffer directly
      const clampedRgbaData = Uint8ClampedArray.from(frame.data);
      const imgData = createImageData(clampedRgbaData, width, height);

      // Calculate Y position for this frame
      const yPos = i * height;

      // Draw the frame's ImageData onto the strip canvas
      ctx.putImageData(imgData, 0, yPos);
      console.debug(`    Drew frame ${i} at Y=${yPos}`);
    }

    // --- Save the strip canvas to PNG ---
    const pngStripBuffer = stripCanvas.toBuffer("image/png");
    await fs.writeFile(outputPath, pngStripBuffer);
    console.log(
      `PNG strip saved: ${outputPath} (${frameCount} frames, ${stripWidth}x${stripHeight})`
    );
  } catch (err) {
    console.error(`Error creating PNG strip ${outputPath}:`, err);
  }
}
