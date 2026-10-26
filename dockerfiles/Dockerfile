# syntax=docker/dockerfile:1.7-labs

# Stages (BuildKit builds independent stages in parallel):
#   toolchain    CUDA devel image + compilers, cmake, node
#   python-env   conda env from server/requirements.txt
#   deps         npm ci for all workspaces
#   modules      installs all modules with the module-installer workspace
#   builder      builds the app (without modules/)
#   (final)      runtime image assembled from the stages above
#
# The modules stage only sees module-installer/ and modules/, so app
# code changes never trigger module rebuilds.

# -------- Toolchain (CUDA devel + build tools shared by all build stages) --------
FROM nvidia/cuda:12.4.1-cudnn-devel-ubuntu22.04 AS toolchain

ENV DEBIAN_FRONTEND=noninteractive \
    NVIDIA_VISIBLE_DEVICES=all \
    NVIDIA_DRIVER_CAPABILITIES=compute,utility \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    CUDA_HOME=/usr/local/cuda

RUN apt-get update && apt-get install -y --no-install-recommends \
    libtiff-dev \
    libpng-dev \
    libjpeg-dev \
    gfortran \
    liblapack-dev \
    libopenblas-dev \
    libxml2 \
    libglpk-dev \
    libxt-dev \
    libcairo2-dev \
    curl \
    wget \
    gnupg \
    git \
    build-essential \
    file \
    python3 \
    python3-venv \
    && rm -rf /var/lib/apt/lists/*

# Install CMake 3.24+
RUN wget https://github.com/Kitware/CMake/releases/download/v3.27.8/cmake-3.27.8-linux-x86_64.tar.gz -O /tmp/cmake.tar.gz \
    && tar -xzf /tmp/cmake.tar.gz -C /usr/local --strip-components=1 \
    && rm /tmp/cmake.tar.gz

# Install Node.js 24.x
RUN curl -fsSL https://deb.nodesource.com/setup_24.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && npm install -g npm@latest \
    && rm -rf /var/lib/apt/lists/*


# -------- Python env (conda, copied as-is into the runtime image) --------
FROM toolchain AS python-env

ENV PATH=/opt/conda/bin:$PATH

RUN wget --quiet https://repo.anaconda.com/miniconda/Miniconda3-latest-Linux-x86_64.sh -O /tmp/miniconda.sh \
    && bash /tmp/miniconda.sh -b -p /opt/conda \
    && rm /tmp/miniconda.sh \
    && /opt/conda/bin/conda clean -afy

COPY server/requirements.txt /tmp/requirements.txt

RUN /opt/conda/bin/conda tos accept --override-channels --channel https://repo.anaconda.com/pkgs/main \
    && /opt/conda/bin/conda tos accept --override-channels --channel https://repo.anaconda.com/pkgs/r \
    && /opt/conda/bin/conda create -n volweb python=3.9 -y \
    && /opt/conda/bin/conda run -n volweb pip install --no-cache-dir -r /tmp/requirements.txt \
    && /opt/conda/bin/conda clean -afy


# -------- JS dependencies --------
FROM toolchain AS deps

WORKDIR /app

COPY package*.json /app/
COPY client/package*.json /app/client/
COPY schemas/package*.json /app/schemas/
COPY server/package*.json /app/server/
COPY module-installer/package*.json /app/module-installer/
RUN npm ci


# -------- Modules (see module-installer/README.md) --------
FROM toolchain AS modules

# Build argument for CUDA architectures (e.g. "native", "80;86;90", or "80")
ARG CUDA_ARCHITECTURES=native

COPY module-installer/ /app/module-installer/
COPY modules/ /app/modules/

# The installer has no dependencies, so no npm install is needed here.
RUN --mount=type=cache,id=volweb-module-cache,target=/app/module-installer/.cache \
    cd /app/module-installer && npm run modules:install


# -------- App builder --------
FROM deps AS builder

# Copy source (modules come from the modules stage)
COPY --exclude=modules ./ /app/

ARG DATABASE_URL
ENV DATABASE_URL=${DATABASE_URL}

# Generate Prisma client and build all workspace packages
RUN cd /app && npm run build:prod


# -------- Runtime stage (leaner image) --------
FROM nvidia/cuda:12.4.1-cudnn-runtime-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive \
    NVIDIA_VISIBLE_DEVICES=all \
    NVIDIA_DRIVER_CAPABILITIES=compute,utility \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    SETUSER=volweb \
    UID=10001 \
    PATH=/opt/conda/bin:$PATH \
    CUDA_HOME=/usr/local/cuda

# Runtime-only system libraries
RUN apt-get update && apt-get install -y --no-install-recommends \
    libtiff5 \
    libpng16-16 \
    libjpeg-turbo8 \
    liblapack3 \
    libopenblas0-pthread \
    libxml2 \
    libglpk40 \
    libxt6 \
    libcairo2 \
    curl \
    gnupg \
    && rm -rf /var/lib/apt/lists/*

# Node.js runtime for npm start scripts
RUN curl -fsSL https://deb.nodesource.com/setup_24.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && npm install -g npm@latest \
    && rm -rf /var/lib/apt/lists/*

# Create runtime user
RUN useradd -m -s /bin/bash -u ${UID} ${SETUSER} \
    && mkdir -p /home/${SETUSER}/.npm \
    && chown -R ${SETUSER}:${SETUSER} /home/${SETUSER}

WORKDIR /app

# Modules go in their own layer before the app layer, so app-only changes
# reuse (and don't re-push) it.
COPY --from=modules --chown=${SETUSER}:${SETUSER} /app/modules /app/modules

# Bring in prepared conda env and built app
COPY --from=python-env /opt/conda /opt/conda
COPY --from=builder --chown=${SETUSER}:${SETUSER} /app /app

ARG DATABASE_URL
ENV DATABASE_URL=${DATABASE_URL}

EXPOSE 8080

USER ${SETUSER}
