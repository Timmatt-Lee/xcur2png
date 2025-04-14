# Xcursor to PNG Converter

A Node.js script to parse Xcursor files, extract individual image frames, and save them as PNG files. For multi-frame cursors containing images of the same size, it generates vertical PNG sprite strips.

## Features

* Parses the Xcursor file format.
* Extracts embedded image frames.
* Handles cursor files containing multiple image sizes (e.g., 32x32 and 64x64) by processing each size group independently.
* Saves single-frame cursors as individual PNG files (e.g., `cursorname_32x32.png`).
* Generates vertical PNG sprite strips for multi-frame cursors (e.g., `cursorname_64x64_strip.png`).
* Limits generated PNG strips to a maximum number of frames (default: 24) by sampling evenly from the original sequence to preserve animation flow.
* Also can support GIF genearation for multi-frame cursors.

## Prerequisites

1.  **Node.js:** Requires Node.js. Developed and tested with v20.19.0 (as of April 2025). Should work on recent LTS versions (v18+). You can download it from [nodejs.org](https://nodejs.org/) or use a version manager like [nvm](https://github.com/nvm-sh/nvm).
2.  **npm or yarn:** Package manager included with Node.js.
3.  **System Build Dependencies for `node-canvas`:** This script uses the `canvas` library, which has native C++ components and requires certain system libraries to be installed *before* you run `npm install`.
    * **macOS:** Requires Xcode Command Line Tools and libraries installed via [Homebrew](https://brew.sh/):
        ```bash
        brew install pkg-config cairo pango libpng jpeg giflib librsvg
        ```
    * **Debian/Ubuntu Linux:** Requires `build-essential`, `pkg-config`, and libraries:
        ```bash
        sudo apt-get update
        sudo apt-get install build-essential libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev
        ```
    * **Fedora/CentOS Linux:** Requires development tools and libraries:
        ```bash
        sudo yum update
        sudo yum groupinstall "Development Tools"
        sudo yum install pkgconfig cairo-devel pango-devel libjpeg-turbo-devel giflib-devel librsvg2-devel
        ```
    * **Windows:** Requires Python and Microsoft Visual C++ Build Tools. The easiest way is often installing `windows-build-tools` via an administrator PowerShell:
        ```powershell
        npm install --global --production windows-build-tools
        # Then potentially install GTK/libraries manually or via a helper script/package manager like vcpkg/msys2
        ```
        *Refer to the official [node-canvas installation guide](https://github.com/Automattic/node-canvas/wiki/Installation) for detailed, up-to-date instructions for your specific OS.*

## Installation

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/Timmatt-Lee/xcur2png.git
    cd xcur2png
    ```

2.  **Ensure Prerequisites are installed:** Make sure you have Node.js and the necessary system build dependencies for `canvas` (see Prerequisites section).

3.  **Install Node.js dependencies:**
    ```bash
    npm install
    # or
    yarn install
    ```

## Usage

1.  **Place Cursors:** Put the Xcursor files you want to convert into a directory named `cursor` inside the project folder. (You can change this path in `index.js`).
2.  **Run the Script:**
    ```bash
    node index.js
    ```
3.  **Check Output:** The script will process the files found by the `glob` pattern (defaulting to `cursor/**/*`). Output PNG files will be saved in the **same directory** as their corresponding original Xcursor files.

## Input

* The script expects valid Xcursor files.
* By default, it searches within the `./cursor/` directory (relative to where you run the script).

## Output

The script generates PNG files based on the content of each Xcursor file:

* **Single-Frame Cursors:** If a cursor size group contains only one frame, it saves `originalName_WIDTHxHEIGHT.png`.
    * Example: `wait_32x32.png`
* **Multi-Frame Cursors:** If a cursor size group contains more than one frame, it saves `originalName_WIDTHxHEIGHT_strip.png`. This file contains the frames (up to the configured limit of 24) stacked vertically.
    * Example: `wait_64x64_strip.png` (This file would have dimensions 64 x (64 * 24) if the original had >= 24 frames).

## Configuration

You can modify the script (`index.js`) for basic configuration:

* **Input Files:** Change the `glob` pattern near the top of the `processFiles` function to target different directories or file patterns. Remember to update the `ignore` pattern if necessary.
    ```javascript
    // Example: Process files directly in the current folder
    const paths = await glob("*.cursor", { ignore: [...] });
    ```
* **Maximum Frames per Strip:** Change the `TARGET_FRAME_COUNT` constant inside the `processFiles` function.
    ```javascript
    const TARGET_FRAME_COUNT = 24; // Change 24 to your desired limit
    ```

## Dependencies

* **`glob`**: Used to find Xcursor files based on patterns.
* **`canvas`**: Used for creating the PNG images (drawing frames, saving canvas buffer). Requires native compilation.

## Troubleshooting

* **`npm install` fails:** This is almost always due to missing system build dependencies for `node-canvas`. Carefully follow the installation instructions for `node-canvas` for your operating system (see Prerequisites). Ensure `pkg-config` and libraries like Cairo, Pango, libjpeg, etc., are installed *before* running `npm install`.
* **`pkg-config: command not found`:** Install `pkg-config` using your system's package manager (`brew install pkg-config`, `sudo apt-get install pkg-config`, etc.).

## Contributing

Contributions, issues, and feature requests are welcome\! Feel free to check [issues page](https://github.com/Timmatt-Lee/xcur2png/issues).

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
