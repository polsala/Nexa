FROM rust:1.94.1-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev patchelf file curl ca-certificates xz-utils webkit2gtk-driver xvfb dbus-x11 xauth && rm -rf /var/lib/apt/lists/*
RUN rustup component add clippy rustfmt
RUN curl -fsSL https://nodejs.org/dist/v24.13.0/node-v24.13.0-linux-x64.tar.xz | tar -xJ -C /usr/local --strip-components=1 && corepack enable && corepack prepare pnpm@10.33.3 --activate
WORKDIR /work
RUN useradd --uid 1000 --create-home --shell /bin/bash nexa
ENV CI=true APPIMAGE_EXTRACT_AND_RUN=1
