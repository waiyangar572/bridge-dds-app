FROM continuumio/miniconda3
# Dealerのビルドに必要なツールをインストール
RUN apt-get update && apt-get install -y build-essential wget unzip tcl-dev

# Dealerのソースコードをダウンロード、ビルド、インストール
WORKDIR /tmp
RUN wget --no-check-certificate https://bridge.thomasoandrews.com/deal/deal319.zip && \
    unzip deal319.zip && \
    cd deal319 && \
    sed -i 's/-fast//g' Make.mac-osx && \
    make CFLAGS="-I/usr/include/tcl" LDFLAGS="-ltcl" && \
    [ -f deal ] && chmod +x deal && cp deal /usr/local/bin/

# --- STAGE 1: Builder ---
# 公式手順に従い、ソースコードから libdds.so をコンパイルするための一時的な環境
FROM debian:bullseye AS builder

# 1. ビルドに必要なツールと、DDSが依存するBoostライブラリをインストール
#    libboost-all-dev: Boost C++ライブラリのヘッダーファイルと開発ツール一式
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    git \
    build-essential \
    ca-certificates \
    libboost-all-dev

# 2. GitHubからソースコードをダウンロード
WORKDIR /usr/src
RUN git clone https://github.com/dds-bridge/dds.git

# 3. 公式手順に従ってライブラリをコンパイル
#    作業ディレクトリをソースコードの `src` ディレクトリに移動します
WORKDIR /usr/src/dds/src

#    Linux共有ライブラリ用のMakefileをコピーして有効化します
RUN cp Makefiles/Makefile_linux_shared ./Makefile

#    makeコマンドを実行してコンパイルします
RUN make

# --- STAGE 2: Final Application ---
# 実際にアプリケーションを動かすための、軽量でクリーンな最終環境
FROM python:3.12-bullseye

RUN apt-get update && \
    apt-get install -y --no-install-recommends libboost-thread1.74.0 && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*



ENV PATH="/usr/local/bin:${PATH}"

# 1. アプリケーションの作業ディレクトリを設定
WORKDIR /app

# 2. Builderステージから、コンパイル済みのライブラリファイルだけをコピー
COPY --from=builder /usr/src/dds/src/libdds.so .

# 3. アプリケーションのコードと設定ファイルをコピー
COPY requirements.txt .
COPY main.py .
COPY dds.py .
COPY leadsolver-deb leadsolver.deb
RUN dpkg -i leadsolver.deb || apt-get -f install -y

# 4. Pythonの依存ライブラリをインストール
RUN pip install --no-cache-dir -r requirements.txt

# 5. コンテナの公開ポートと起動コマンドを設定
EXPOSE 8080
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8080"]